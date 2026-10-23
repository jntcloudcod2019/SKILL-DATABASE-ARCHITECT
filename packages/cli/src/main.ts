import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertSchema, validateSchema, type CanonicalModel, type Mode } from '@dbarchitect/core';
import { Engine, EngineError, SUPPORT, generators } from '@dbarchitect/engine';
import { validateModel } from '@dbarchitect/validators';
import { startStudioServer } from './server.ts';

const HELP = `dbarchitect — Database Architect Studio

Uso: dbarchitect <comando> [diretório] [opções]

Sessão
  init [dir]                Cria .database-architect/ (somente metadados; nenhuma entidade é inventada)
                            --name <nome> --mode greenfield|brownfield|evolution --description <texto>
  status [dir]              Estado, pendências e aprovação (--json)
  open [dir]                Inicia/retoma a sessão no Studio  (--mode ao criar; --port; --no-open)
  studio [dir]              Igual a open (somente servidor + URL)

Análise
  scan [dir]                Varre o código autorizado e grava fatos + cobertura (não altera o modelo)
  analyze [dir]             scan + importa os fatos estruturais para o modelo (brownfield/evolution)
  import-docs <arquivos...> Importa documentos/contratos (OpenAPI, JSON Schema, Markdown) como fontes

Modelo
  validate [dir|model.json] Executa os validadores determinísticos (--json)
  diff [dir]                Diferenças do modelo (--from <rev> --to <rev>; padrão: baseline/revisão anterior)
  approve [dir]             Aprovação humana da versão atual (--by <nome> --note <texto>)
  export [dir] <arquivo>    Exporta o modelo canônico para um arquivo JSON
  import <arquivo> [dir]    Importa um modelo canônico exportado (somente em sessão vazia)

Geração
  generate [dir]            Gera em staging: --target sql|prisma|ef-core|dapper --dialect postgresql|sqlserver|sqlite|mysql
  plan-apply [dir]          Mostra o diff do que seria gravado no projeto (--target --dialect --out)
  apply [dir]               Grava no projeto. Exige --yes-write (e --overwrite para substituir arquivos existentes)
  fixes [dir]               Lista as correções aplicáveis para cada problema da validação (--json)
  fix <issueId> <fixId> [dir]  Aplica uma correção (ou --all-rule <regra> --fix <fixId> para aplicar em lote)
  support                   Matriz real de alvos × dialetos

Nenhum comando aplica migrations nem conecta a bancos.`;

function out(s: string): void { process.stdout.write(s + '\n'); }
function err(s: string): void { process.stderr.write(s + '\n'); }

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* URL is printed anyway */ }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { out(HELP); return cmd ? 0 : 1; }
  try {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true,
      options: {
        name: { type: 'string' }, mode: { type: 'string' }, description: { type: 'string' }, json: { type: 'boolean' }, port: { type: 'string' }, 'no-open': { type: 'boolean' },
        from: { type: 'string' }, to: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' }, target: { type: 'string' }, dialect: { type: 'string' },
        out: { type: 'string' }, 'yes-write': { type: 'boolean' }, overwrite: { type: 'boolean' }, namespace: { type: 'string' }, 'all-rule': { type: 'string' }, fix: { type: 'string' }, reimport: { type: 'boolean' },
      },
    });
    const dirOf = (i = 0) => resolve(positionals[i] ?? '.');
    const mode = values.mode as Mode | undefined;
    if (mode && !['greenfield', 'brownfield', 'evolution'].includes(mode)) throw new EngineError('BAD_ARG', '--mode deve ser greenfield, brownfield ou evolution');

    switch (cmd) {
      case 'init': {
        const e = new Engine(dirOf());
        const m = e.init({ name: values.name, mode, description: values.description });
        out(`Sessão criada em ${e.store.dir}\n  projeto: ${m.project.name}\n  modo:    ${m.project.mode}\n  estado:  ${m.status.state}\nNenhuma entidade, ORM ou banco foi escolhido.`);
        return 0;
      }
      case 'status': {
        const s = new Engine(dirOf()).status();
        if (values.json) out(JSON.stringify(s, null, 2));
        else out(`${s.project} [${s.mode}]  estado=${s.state}  revisão=${s.revision}\n  entidades=${s.counts.entities} relacionamentos=${s.counts.relationships} conceitos=${s.counts.concepts} contratos=${s.counts.contracts}\n  pendências: ${s.pending.questions} perguntas (${s.pending.critical} críticas), ${s.pending.hypotheses} hipóteses\n  aprovação: ${s.approval ? `válida (${s.approval.approvedBy}, rev ${s.approval.revision})` : 'nenhuma válida para esta versão'}\n  hash: ${s.hash.slice(0, 16)}…`);
        return 0;
      }
      case 'open':
      case 'studio': {
        const root = dirOf();
        const e = new Engine(root);
        if (!e.hasSession()) { e.init({ mode: mode ?? 'greenfield', name: values.name, description: values.description }); out('Sessão nova criada.'); }
        else if (mode) err(`Aviso: sessão existente (${e.load().project.mode}); --mode ignorado.`);
        const s = await startStudioServer(root, { port: values.port ? Number(values.port) : 0 });
        out(`Database Architect Studio: ${s.url}\n(somente 127.0.0.1; Ctrl+C para encerrar)`);
        if (!values['no-open']) openBrowser(s.url);
        await new Promise<void>((r) => { process.once('SIGINT', r); process.once('SIGTERM', r); });
        await s.close();
        return 0;
      }
      case 'scan':
      case 'analyze': {
        const e = new Engine(dirOf());
        if (!e.hasSession()) e.init({ mode: mode ?? 'brownfield', name: values.name });
        const sc = e.scan();
        out(`Tecnologias: ${sc.facts.technologies.map((t) => t.name).join(', ') || '(nenhuma detectada)'}\nTabelas: ${sc.facts.tables.length}  Relações: ${sc.facts.relations.length}  Contratos: ${sc.facts.contracts.length}  Migrations: ${sc.facts.migrations.length}`);
        out(`Cobertura: ${sc.coverage.filesRead} arquivos lidos; ${sc.coverage.skipped.secretFiles.length} secretos ignorados; ${sc.coverage.uninterpreted.length} não interpretados.`);
        for (const l of sc.facts.limitations) out(`  limitação: ${l}`);
        if (cmd === 'analyze') { const m = e.importScan({ replace: !!values.reimport }); out(`Modelo atualizado: ${m.entities.length} entidades, ${m.relationships.length} relacionamentos, ${m.questions.filter((q) => q.status === 'open').length} pendências. Estado: ${m.status.state}`); }
        return 0;
      }
      case 'import-docs': {
        const root = resolve('.');
        const e = new Engine(root);
        const r = e.importDocuments(positionals);
        out(`Importados: ${r.imported.join(', ') || '(nenhum)'}  contratos: ${r.contracts}`);
        for (const s of r.skipped) err(`  ignorado ${s.path}: ${s.reason}`);
        return r.skipped.length && !r.imported.length ? 1 : 0;
      }
      case 'validate': {
        const target = positionals[0] ?? '.';
        let model: CanonicalModel;
        let issues;
        let blocking: number;
        if (target.endsWith('.json')) {
          const raw = JSON.parse(readFileSync(resolve(target), 'utf8'));
          const sv = validateSchema(raw);
          if (!sv.valid) { err('Modelo não corresponde ao JSON Schema do CSM:\n  ' + sv.errors.join('\n  ')); return 2; }
          model = raw as CanonicalModel;
          const r = validateModel(model);
          issues = r.issues; blocking = r.blocking;
        } else {
          const r = new Engine(resolve(target)).validate();
          issues = r.issues; blocking = r.blocking;
        }
        if (values.json) out(JSON.stringify({ blocking, issues }, null, 2));
        else {
          for (const i of issues) out(`[${i.severity}${i.blocking ? ' ⛔' : ''}] ${i.rule} ${i.message}\n    → ${i.recommendation}`);
          out(`${issues.length} problema(s), ${blocking} bloqueante(s).`);
        }
        return blocking ? 1 : 0;
      }
      case 'diff': {
        const ch = new Engine(dirOf()).diff(values.from ? Number(values.from) : undefined, values.to ? Number(values.to) : undefined);
        if (values.json) out(JSON.stringify(ch, null, 2));
        else { for (const c of ch) out(`${c.risk === 'destructive' ? '‼' : c.risk === 'risky' ? '!' : '·'} [${c.risk}] ${c.description}${c.reason ? `\n    ${c.reason}` : ''}`); if (!ch.length) out('Sem diferenças.'); }
        return 0;
      }
      case 'approve': {
        const by = values.by;
        if (!by) throw new EngineError('NO_APPROVER', 'Informe --by <nome>: a aprovação é um ato humano explícito.');
        const m = new Engine(dirOf()).approve(by, values.note);
        out(`Aprovado: revisão ${m.status.revision} por ${by}. Estado ${m.status.state}.`);
        return 0;
      }
      case 'export': {
        const e = new Engine(dirOf());
        const file = positionals[1];
        if (!file) throw new EngineError('BAD_ARG', 'Uso: export [dir] <arquivo>');
        writeFileSync(resolve(file), JSON.stringify(e.load(), null, 2) + '\n');
        out(`Exportado para ${file}`);
        return 0;
      }
      case 'import': {
        const file = positionals[0];
        if (!file) throw new EngineError('BAD_ARG', 'Uso: import <arquivo> [dir]');
        const raw = JSON.parse(readFileSync(resolve(file), 'utf8'));
        assertSchema(raw);
        const e = new Engine(dirOf(1));
        if (e.hasSession()) throw new EngineError('EXISTS', 'Já existe sessão neste diretório; importe em um diretório vazio para não sobrescrever trabalho.');
        raw.status.state = 'DRAFT';
        raw.approvals = raw.approvals.map((a) => ({ ...a, invalidatedAt: a.invalidatedAt ?? new Date().toISOString() }));
        e.store.saveModel(raw);
        out(`Modelo importado (${raw.entities.length} entidades). Aprovações anteriores foram invalidadas: revise e aprove novamente.`);
        return 0;
      }
      case 'generate': {
        if (!values.target) throw new EngineError('BAD_ARG', `--target é obrigatório (${Object.keys(generators).join('|')})`);
        const man = new Engine(dirOf()).generate(values.target, { dialect: values.dialect, options: values.namespace ? { namespace: values.namespace } : {} });
        out(`Gerado em staging: ${man.stagingDir}\n${man.files.map((f) => `  ${f.path}`).join('\n')}`);
        for (const v of man.verification) out(`verificação ${v.name}: ${v.status} — ${v.detail}`);
        for (const w of man.report.warnings) out(`  aviso: ${w}`);
        for (const n of man.report.notes) out(`  nota: ${n}`);
        for (const u of man.report.unsupported) out(`  não suportado: ${u}`);
        out('Nada foi gravado no projeto. Revise com "plan-apply".');
        return man.verification.some((v) => v.status === 'failed') ? 1 : 0;
      }
      case 'plan-apply': {
        if (!values.target || !values.dialect) throw new EngineError('BAD_ARG', '--target e --dialect são obrigatórios');
        for (const i of new Engine(dirOf()).planApply(values.target, values.dialect, values.out)) {
          out(`${i.status.toUpperCase().padEnd(9)} ${i.path}${i.reason ? ` (${i.reason})` : ''}`);
          if (i.diff) out(i.diff);
        }
        return 0;
      }
      case 'apply': {
        if (!values.target || !values.dialect) throw new EngineError('BAD_ARG', '--target e --dialect são obrigatórios');
        const man = new Engine(dirOf()).apply(values.target, values.dialect, { authorize: !!values['yes-write'], outDir: values.out, overwrite: !!values.overwrite });
        out(`Gravados: ${man.applied!.written.join(', ') || '(nenhum)'}`);
        for (const s of man.applied!.skipped) out(`  não gravado ${s.path}: ${s.reason}`);
        return 0;
      }
      case 'fixes': {
        const r = new Engine(dirOf()).validate({ persist: false });
        const withFixes = r.issues.filter((i) => i.fixes?.length);
        if (values.json) out(JSON.stringify(withFixes.map((i) => ({ issueId: i.id, rule: i.rule, message: i.message, fixes: i.fixes!.map((f) => ({ id: f.id, label: f.label, decision: !!f.decision })) })), null, 2));
        else for (const i of withFixes) { out(`${i.id}\n  ${i.message}`); for (const f of i.fixes!) out(`    [${f.id}] ${f.label}${f.decision ? '  (decisão de negócio)' : ''}`); }
        out(`${withFixes.length} problema(s) com correção disponível.`);
        return 0;
      }
      case 'fix': {
        const e = new Engine(dirOf(values['all-rule'] ? 0 : 2));
        let items: Array<{ issueId: string; fixId: string }>;
        if (values['all-rule']) {
          if (!values.fix) throw new EngineError('BAD_ARG', 'Uso: fix --all-rule <regra> --fix <fixId> [dir]');
          items = e.validate({ persist: false }).issues.filter((i) => i.rule === values['all-rule'] && i.fixes?.some((f) => f.id === values.fix)).map((i) => ({ issueId: i.id, fixId: values.fix! }));
        } else {
          if (positionals.length < 2) throw new EngineError('BAD_ARG', 'Uso: fix <issueId> <fixId> [dir]');
          items = [{ issueId: positionals[0], fixId: positionals[1] }];
        }
        const m = e.applyFixes(items);
        out(`${items.length} correção(ões) aplicada(s). Revisão ${m.status.revision}, estado ${m.status.state}. Aprovações anteriores foram invalidadas.`);
        return 0;
      }
      case 'support': {
        for (const s of SUPPORT) out(`${s.target.padEnd(8)} ${s.dialect.padEnd(11)} ${s.verification}`);
        return 0;
      }
      default:
        err(`Comando desconhecido: ${cmd}\n`);
        out(HELP);
        return 1;
    }
  } catch (e) {
    const x = e as Error & { code?: string; errors?: string[] };
    err(`Erro${x.code ? ` [${x.code}]` : ''}: ${x.message}`);
    for (const d of x.errors?.slice(0, 10) ?? []) err(`  ${d}`);
    return x.code === 'BLOCKED' || x.code === 'NOT_APPROVED' || x.code === 'NOT_AUTHORIZED' ? 3 : 2;
  }
}
