import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  InvalidTransitionError, uniqueId, applyOps, assertSchema, assertTransition, canTransition, computeOps, createEmptyModel, diffModels, nowIso, slug, unifiedDiff,
  type Approval, type CanonicalModel, type Change, type Facts, type GeneratedFile, type GeneratorReport, type Issue, type Mode, type ModelState, type Op, type Origin, type Source,
} from '@dbarchitect/core';
import { Store, domainHash, modelHash, safeResolve, sha256, STORE_DIR } from '@dbarchitect/core/node';
import { allRules, applyFix, validateModel, type ValidationResult } from '@dbarchitect/validators';
import { scan, type CoverageReport } from '@dbarchitect/project-scanner';
import { dotnetAnalyzers } from '@dbarchitect/adapter-dotnet';
import { nodeAnalyzers } from '@dbarchitect/adapter-nodejs';
import { contractAnalyzers } from '@dbarchitect/adapter-contracts';
import { dialects } from '@dbarchitect/adapter-sql';
import { factsToModel } from './import-facts.ts';
import { generators, verifySqliteDdl, type VerificationResult } from './generators.ts';

export const analyzers = [...dotnetAnalyzers, ...nodeAnalyzers, ...contractAnalyzers];

export class EngineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ScanSummary {
  facts: Facts;
  coverage: CoverageReport;
  at: string;
}

export interface GenerationManifest {
  target: string;
  dialect: string;
  revision: number;
  modelHash: string;
  at: string;
  stagingDir: string;
  files: Array<{ path: string; sha256: string; kind: string }>;
  report: GeneratorReport;
  verification: VerificationResult[];
  applied?: { at: string; written: string[]; skipped: Array<{ path: string; reason: string }> };
}

export interface ApplyPlanItem {
  path: string;
  status: 'new' | 'unchanged' | 'modified' | 'blocked';
  reason?: string;
  diff?: string;
}

const MIGRATION_PATH = /(^|\/)(migrations?|Migrations)\//;

/** Stateless facade over the on-disk session: every call loads, mutates and saves, so CLI, Studio and MCP stay consistent. */
export class Engine {
  readonly root: string;
  readonly store: Store;

  constructor(root: string) {
    if (!existsSync(root)) throw new EngineError('NO_ROOT', `Diretório não encontrado: ${root}`);
    this.root = root;
    this.store = new Store(root);
  }

  // ---- session lifecycle ----------------------------------------------------------------

  /** Creates only the tool's metadata folder. No entities are invented, no ORM is chosen. */
  init(opts: { name?: string; mode?: Mode; description?: string }): CanonicalModel {
    if (this.store.exists()) throw new EngineError('EXISTS', 'Já existe uma sessão de modelagem neste diretório. Use "status" ou "open".');
    const name = opts.name ?? this.root.split('/').filter(Boolean).pop() ?? 'project';
    const m = createEmptyModel({ name, mode: opts.mode ?? 'greenfield', rootDir: '.', description: opts.description });
    if (opts.description)
      m.sources.push({ id: 'src_description', kind: 'description', title: 'Descrição inicial', importedAt: nowIso(), excerpt: opts.description.slice(0, 2000) });
    this.commit(m, null, 'manual', 'Sessão criada');
    return this.store.loadModel();
  }

  load(): CanonicalModel {
    return this.store.loadModel();
  }

  hasSession(): boolean {
    return this.store.exists();
  }

  currentHash(m = this.load()): string {
    return modelHash(m);
  }

  // ---- state & persistence ---------------------------------------------------------------

  private moveTo(m: CanonicalModel, to: ModelState): void {
    const from = m.status.state;
    if (from === to) return;
    if (canTransition(from, to)) { m.status.state = to; return; }
    // Explicit two-step path through DRAFT, still validated against the table.
    assertTransition(from, 'DRAFT');
    assertTransition('DRAFT', to);
    m.status.state = to;
  }

  /** Saves `next`, invalidating approvals whose hash no longer matches and recording history. */
  private commit(next: CanonicalModel, prev: CanonicalModel | null, author: Origin, summary: string): CanonicalModel {
    const m = structuredClone(next);
    const at = nowIso();
    const hash = modelHash(m);
    const dHash = domainHash(m);
    const changed = !prev || modelHash(prev) !== hash;
    if (changed) m.status.revision = (prev?.status.revision ?? -1) + 1;
    m.status.updatedAt = at;
    for (const a of m.approvals) {
      if (a.invalidatedAt) continue;
      if ((a.stage === 'model' && a.hash !== hash) || (a.stage === 'domain' && a.hash !== dHash)) a.invalidatedAt = at;
    }
    if (changed && prev) {
      // Content changed: any state past DRAFT is stale. Review/approval must be redone.
      if (['READY_FOR_REVIEW', 'APPROVED', 'GENERATED', 'FAILED', 'DISCOVERING', 'ANALYZING', 'VALIDATING'].includes(m.status.state)) this.moveTo(m, 'DRAFT');
      const critical = m.questions.some((q) => q.impact === 'critical' && q.status === 'open');
      this.moveTo(m, critical ? 'NEEDS_INPUT' : 'DRAFT');
      delete m.status.reviewedAt;
      m.history.push({ revision: m.status.revision, at, author, summary, hash });
    }
    this.store.saveModel(m);
    return m;
  }

  /**
   * Applies validated operations. `author` tags provenance rules: AI may not claim "code" origin without file evidence,
   * and manual edits are flagged so the Studio can show what a human changed.
   */
  applyOps(ops: Op[], opts: { author?: Origin; summary?: string; expectedRevision?: number } = {}): CanonicalModel {
    const prev = this.load();
    const author = opts.author ?? 'ai';
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== prev.status.revision)
      throw new EngineError('CONFLICT', `O modelo mudou (revisão ${prev.status.revision}, esperada ${opts.expectedRevision}). Recarregue antes de salvar.`);
    if (prev.status.state === 'GENERATING') throw new EngineError('BUSY', 'Geração em andamento.');
    for (const op of ops) {
      if (op.op !== 'upsert') continue;
      const p = op.item.provenance as { origin?: string; evidence?: Array<{ file?: string }> } | undefined;
      if (author === 'ai' && p?.origin === 'code' && !p.evidence?.some((e) => e.file))
        throw new EngineError('UNSUPPORTED_CLAIM', `${op.collection}/${op.item.id}: origem "code" exige evidência com arquivo. Use origem "ai" para inferências.`);
      if (author === 'manual' && p) {
        const existed = JSON.stringify((prev as unknown as Record<string, unknown>)[op.collection.split('.')[0]] ?? '').includes(`"id":"${op.item.id}"`)
          || JSON.stringify(prev.domain).includes(`"id":"${op.item.id}"`);
        if (existed) (op.item.provenance as { manuallyEdited?: boolean }).manuallyEdited = true;
      }
    }
    const next = applyOps(prev, ops);
    assertSchema(next);
    return this.commit(next, prev, author, opts.summary ?? `${ops.length} operação(ões)`);
  }

  /** Replace the whole model through ops diff (used by the Studio "save"). */
  saveEdited(edited: CanonicalModel, expectedRevision: number): CanonicalModel {
    const prev = this.load();
    return this.applyOps(computeOps(prev, edited), { author: 'manual', expectedRevision, summary: 'Edição no Studio' });
  }

  /**
   * Applies validator-suggested corrections as ONE new revision. Issues are re-computed against the current model, so a stale
   * issue/fix id is rejected instead of guessed. Always recorded as a manual edit; approvals are invalidated by the usual hash rule.
   */
  applyFixes(items: Array<{ issueId: string; fixId: string }>, expectedRevision?: number): CanonicalModel {
    if (!items.length) throw new EngineError('NO_FIX', 'Nenhuma correção selecionada.');
    const prev = this.load();
    if (expectedRevision !== undefined && expectedRevision !== prev.status.revision)
      throw new EngineError('CONFLICT', `O modelo mudou (revisão ${prev.status.revision}, esperada ${expectedRevision}).`);
    const issues = this.validate({ persist: false }).issues;
    let cur = prev;
    const labels: string[] = [];
    for (const it of items) {
      const issue = issues.find((i) => i.id === it.issueId);
      const fix = issue?.fixes?.find((f) => f.id === it.fixId);
      if (!issue || !fix) throw new EngineError('FIX_NOT_FOUND', `Correção indisponível: ${it.issueId} / ${it.fixId} (o problema pode já ter sido resolvido).`);
      cur = applyFix(cur, fix);
      labels.push(fix.label);
    }
    const summary = items.length === 1 ? `Correção aplicada: ${labels[0]}` : `${items.length} correções aplicadas (${[...new Set(labels)].join('; ')})`;
    return this.applyOps(computeOps(prev, cur), { author: 'manual', expectedRevision: prev.status.revision, summary });
  }

  // ---- analysis ------------------------------------------------------------------------

  /** Scans the authorized root and stores facts + coverage. Does not modify the model. */
  scan(): ScanSummary {
    const m = this.load();
    this.setState(m, 'ANALYZING');
    const { facts, coverage } = scan(this.root, analyzers);
    const seen = new Set<string>();
    facts.technologies = facts.technologies.filter((t) => { const k = t.kind + t.name; if (seen.has(k)) return false; seen.add(k); return true; });
    facts.limitations = [...new Set(facts.limitations)];
    const summary: ScanSummary = { facts, coverage, at: nowIso() };
    this.store.writeJson('scan.json', summary);
    return summary;
  }

  lastScan(): ScanSummary | undefined {
    return this.store.readJson<ScanSummary>('scan.json');
  }

  private setState(m: CanonicalModel, to: ModelState): void {
    const cur = this.load();
    // A scan must not demote a reviewed/approved model; it only moves sessions that are still being worked on.
    if (cur.status.state === to || !['DISCOVERING', 'DRAFT', 'NEEDS_INPUT', 'FAILED', 'ANALYZING'].includes(cur.status.state)) return;
    this.moveTo(cur, to);
    cur.status.updatedAt = nowIso();
    this.store.writeJson('model.json', cur);
    Object.assign(m, cur);
  }

  /**
   * Imports the latest scan's structural facts into the model (brownfield/evolution).
   * `replace` re-imports after the scanner improved: code-derived elements are rebuilt, while anything the user or AI added is kept.
   * It refuses when a non-code element still references a code entity (it would dangle) and says which.
   */
  importScan(opts: { replace?: boolean } = {}): CanonicalModel {
    let prev = this.load();
    const s = this.lastScan();
    if (!s) throw new EngineError('NO_SCAN', 'Execute "scan" antes de importar.');
    if (prev.entities.some((e) => e.provenance.origin === 'code')) {
      if (!opts.replace) throw new EngineError('ALREADY_IMPORTED', 'Os fatos do código já foram importados. Use a reimportação (analyze --reimport) para reconstruir a partir do scan atual preservando o que você e a IA adicionaram.');
      const gone = new Set(prev.entities.filter((e) => e.provenance.origin === 'code').map((e) => e.id));
      const blockers: string[] = [];
      const code = (x: { provenance?: { origin: string } }) => x.provenance?.origin === 'code';
      for (const r of prev.relationships) if (!code(r) && (gone.has(r.from.entity) || gone.has(r.to.entity))) blockers.push(`relacionamento ${r.id}`);
      for (const i of prev.indexes) if (!code(i) && gone.has(i.entity)) blockers.push(`índice ${i.id}`);
      for (const q of prev.queries) if (!code(q) && gone.has(q.entity)) blockers.push(`consulta ${q.id}`);
      for (const m of prev.mappings) if (m.entity && gone.has(m.entity)) blockers.push(`mapeamento de contrato ${m.id}`);
      for (const c of prev.domain.concepts) if (c.mapsToEntity && gone.has(c.mapsToEntity)) blockers.push(`conceito ${c.name} → ${c.mapsToEntity}`);
      if (blockers.length) throw new EngineError('REIMPORT_BLOCKED', `Há elementos de usuário/IA apontando para entidades vindas do código (${blockers.slice(0, 8).join('; ')}). Remova ou reaponte-os antes de reimportar.`);
      const next = structuredClone(prev);
      next.entities = next.entities.filter((e) => !gone.has(e.id));
      next.relationships = next.relationships.filter((r) => !code(r) && !gone.has(r.from.entity) && !gone.has(r.to.entity));
      next.indexes = next.indexes.filter((i) => !code(i) && !gone.has(i.entity));
      next.queries = next.queries.filter((q) => !code(q) && !gone.has(q.entity));
      next.enums = next.enums.filter((x) => !code(x));
      next.contracts = next.contracts.filter((c) => !code(c));
      // open code-derived questions are regenerated from the new scan; answered ones are kept as decisions already made
      next.questions = next.questions.filter((q) => !(code(q) && q.status !== 'answered'));
      next.sources = next.sources.filter((x) => x.id !== 'src_code');
      prev = next;
    }
    const next = factsToModel(prev, s.facts);
    // One question per distinct (file, reason); ids must be unique even when a file yields several findings.
    const seenReasons = new Set<string>();
    for (const c of s.coverage.uninterpreted) {
      const text = `Arquivo não interpretado: ${c.file}. ${c.reason}`;
      if (seenReasons.has(text) || seenReasons.size >= 50 || next.questions.some((q) => q.text === text)) continue;
      seenReasons.add(text);
      next.questions.push({ id: uniqueId(`q_uninterp_${slug(c.file)}`.slice(0, 100), next.questions.map((q) => q.id)), text, impact: 'low', status: 'open', provenance: { origin: 'code' } });
    }
    next.sources.push({ id: 'src_code', kind: 'code', title: `Análise do código (${s.facts.tables.length} tabelas, ${s.facts.contracts.length} contratos)`, importedAt: s.at });
    const out = this.commit(next, prev, 'code', 'Fatos importados do código');
    // Baseline = what exists today; used to show only evolution changes.
    this.store.writeJson('baseline.json', out);
    return out;
  }

  baseline(): CanonicalModel | undefined {
    return this.store.readJson<CanonicalModel>('baseline.json');
  }

  /** Registers documents/contracts from authorized paths as sources (and contracts for OpenAPI / JSON Schema). */
  importDocuments(paths: string[]): { imported: string[]; contracts: number; skipped: Array<{ path: string; reason: string }> } {
    const prev = this.load();
    const next = structuredClone(prev);
    const imported: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    let contracts = 0;
    for (const p of paths) {
      let abs: string;
      try { abs = safeResolve(this.root, p); } catch (e) { skipped.push({ path: p, reason: (e as Error).message }); continue; }
      const rel = relative(this.store.root, abs).split('\\').join('/');
      if (!existsSync(abs) || !statSync(abs).isFile()) { skipped.push({ path: p, reason: 'arquivo não encontrado' }); continue; }
      if (/(^|\/)(\.env|.*\.(pem|key|pfx))/i.test(rel)) { skipped.push({ path: p, reason: 'arquivo potencialmente secreto' }); continue; }
      if (statSync(abs).size > 2_000_000) { skipped.push({ path: p, reason: 'arquivo grande demais (>2MB)' }); continue; }
      const content = readFileSync(abs, 'utf8');
      const file = { path: rel, content };
      let kind: Source['kind'] = 'document';
      for (const a of contractAnalyzers.filter((x) => x.accepts(rel) && x.id !== 'connection-config')) {
        const f = a.analyze([file]);
        for (const c of f.contracts ?? []) if (!next.contracts.some((x) => x.id === c.id)) { next.contracts.push(c); contracts++; kind = a.id === 'openapi' ? 'openapi' : 'json-schema'; }
      }
      const id = uniqueSourceId(next, rel);
      next.sources.push({ id, kind, title: rel.split('/').pop() ?? rel, path: rel, importedAt: nowIso(), excerpt: content.replace(/\s+/g, ' ').slice(0, 600) });
      imported.push(rel);
    }
    if (imported.length) this.commit(next, prev, 'document', `Importados ${imported.length} documento(s)`);
    return { imported, contracts, skipped };
  }

  // ---- validation / approval -----------------------------------------------------------

  previousApproved(): CanonicalModel | undefined {
    const generated = [...this.load().approvals].filter((a) => a.stage === 'model').sort((a, b) => b.revision - a.revision);
    for (const a of generated) {
      try { return this.store.loadVersion(a.revision); } catch { /* version missing */ }
    }
    return this.baseline();
  }

  validate(opts: { persist?: boolean } = {}): ValidationResult & { hash: string } {
    const m = this.load();
    const dialect = m.project.profile.database ? dialects[m.project.profile.database] : undefined;
    const prevModel = this.previousApprovedBefore(m);
    const r = validateModel(m, { dialect, previous: prevModel });
    const hash = modelHash(m);
    if (opts.persist !== false) {
      m.status.lastValidation = { hash, at: nowIso(), blocking: r.blocking, total: r.issues.length };
      const stable = ['APPROVED', 'GENERATED', 'GENERATING'].includes(m.status.state) && this.hasValidApproval(m);
      if (!stable) {
        this.moveTo(m, 'VALIDATING');
        const critical = m.questions.some((q) => q.impact === 'critical' && q.status === 'open');
        if (r.blocking === 0) { this.moveTo(m, 'READY_FOR_REVIEW'); m.status.reviewedAt = nowIso(); }
        else this.moveTo(m, critical ? 'NEEDS_INPUT' : 'DRAFT');
      }
      m.status.updatedAt = nowIso();
      this.store.writeJson('model.json', m);
      this.store.writeJson('validation.json', { hash, at: nowIso(), issues: r.issues });
    }
    return { ...r, hash };
  }

  /** Baseline for destructive-change detection: the last approved revision, excluding the current one. */
  private previousApprovedBefore(m: CanonicalModel): CanonicalModel | undefined {
    const approvals = m.approvals.filter((a) => a.stage === 'model' && a.revision < m.status.revision).sort((a, b) => b.revision - a.revision);
    for (const a of approvals) { try { return this.store.loadVersion(a.revision); } catch { /* skip */ } }
    return m.project.mode === 'greenfield' ? undefined : this.baseline();
  }

  hasValidApproval(m = this.load()): Approval | undefined {
    const h = modelHash(m);
    return m.approvals.find((a) => a.stage === 'model' && !a.invalidatedAt && a.hash === h);
  }

  issues(): Issue[] {
    return this.store.readJson<{ issues: Issue[] }>('validation.json')?.issues ?? [];
  }

  /** Domain-stage approval (greenfield review before logical modeling). Bound to the domain hash. */
  approveDomain(by: string, note?: string): CanonicalModel {
    const prev = this.load();
    if (!by.trim()) throw new EngineError('NO_APPROVER', 'Informe quem está aprovando.');
    if (prev.questions.some((q) => q.impact === 'critical' && q.status === 'open' && q.relatedTo?.some((r) => prev.domain.concepts.some((c) => c.id === r))))
      throw new EngineError('BLOCKED', 'Há perguntas críticas abertas sobre conceitos do domínio.');
    const next = structuredClone(prev);
    next.approvals.push({ stage: 'domain', revision: prev.status.revision, hash: domainHash(prev), approvedAt: nowIso(), approvedBy: by, ...(note ? { note } : {}) });
    next.history.push({ revision: prev.status.revision, at: nowIso(), author: 'manual', summary: 'Modelo de domínio aprovado', hash: modelHash(prev) });
    this.store.saveModel(next);
    return next;
  }

  /** Approval requires: fresh validation of this exact hash with zero blocking issues, and a named approver. */
  approve(by: string, note?: string): CanonicalModel {
    if (!by.trim()) throw new EngineError('NO_APPROVER', 'Informe quem está aprovando.');
    const r = this.validate();
    const m = this.load();
    if (r.blocking > 0)
      throw new EngineError('BLOCKED', `Aprovação bloqueada: ${r.blocking} problema(s) bloqueante(s). Corrija ou responda às decisões críticas.`);
    if (m.status.state !== 'READY_FOR_REVIEW') throw new EngineError('BAD_STATE', `Estado ${m.status.state}: o modelo precisa estar READY_FOR_REVIEW para ser aprovado.`);
    if (m.status.lastValidation?.hash !== r.hash) throw new EngineError('STALE', 'A validação não corresponde à versão atual do modelo.');
    this.moveTo(m, 'APPROVED');
    m.approvals.push({ stage: 'model', revision: m.status.revision, hash: r.hash, approvedAt: nowIso(), approvedBy: by, ...(note ? { note } : {}) });
    m.history.push({ revision: m.status.revision, at: nowIso(), author: 'manual', summary: `Modelo aprovado por ${by}`, hash: r.hash });
    m.status.updatedAt = nowIso();
    this.store.saveModel(m);
    return m;
  }

  // ---- diff ----------------------------------------------------------------------------

  diff(from?: number, to?: number): Change[] {
    const cur = this.load();
    const a = from !== undefined ? this.store.loadVersion(from) : (this.baseline() ?? this.store.loadVersion(Math.max(0, cur.status.revision - 1)));
    const b = to !== undefined ? this.store.loadVersion(to) : cur;
    return diffModels(a, b);
  }

  // ---- generation ----------------------------------------------------------------------

  /**
   * Generates into staging (.database-architect/generated/...). Requires a valid approval of the CURRENT hash and a confirmed
   * technology profile. Does not touch the project: see planApply/apply.
   */
  generate(target: string, opts: { dialect?: string; options?: Record<string, unknown> } = {}): GenerationManifest {
    const m = this.load();
    const g = generators[target];
    if (!g) throw new EngineError('UNKNOWN_TARGET', `Alvo desconhecido: ${target}. Disponíveis: ${Object.keys(generators).join(', ')}`);
    const approval = this.hasValidApproval(m);
    if (!approval) throw new EngineError('NOT_APPROVED', 'Geração exige aprovação válida da versão atual do modelo (a aprovação é invalidada por qualquer alteração).');
    if (!m.project.profile.confirmed && !opts.dialect) throw new EngineError('NO_PROFILE', 'O perfil tecnológico não foi confirmado. Defina banco/persistência e confirme antes de gerar.');
    const dialect = (opts.dialect ?? m.project.profile.database) as 'postgresql' | 'sqlserver' | 'sqlite' | 'mysql' | undefined;
    if (!dialect || !g.dialects.includes(dialect)) throw new EngineError('BAD_DIALECT', `Dialeto inválido para ${target}: ${dialect ?? '(não definido)'}`);
    const hash = modelHash(m);
    this.moveTo(m, 'GENERATING');
    this.store.writeJson('model.json', m);
    try {
      const prev = this.previousApprovedBefore(m);
      const { files, report } = g.generate({ model: m, revision: m.status.revision, hash, dialect, previous: prev, options: opts.options ?? {} });
      const dir = join('generated', `${target}-${dialect}`, `r${String(m.status.revision).padStart(4, '0')}`);
      for (const f of files) this.store.writeText(join(dir, f.path), f.content);
      const verification: VerificationResult[] = [];
      if (dialect === 'sqlite' && (target === 'sql' || target === 'dapper')) verification.push(verifySqliteDdl(files));
      else verification.push({ name: 'runtime-verification', status: 'skipped', detail: `Sem verificação em execução para ${target}/${dialect} neste ambiente; revise os arquivos e use as ferramentas oficiais.` });
      const manifest: GenerationManifest = {
        target, dialect, revision: m.status.revision, modelHash: hash, at: nowIso(), stagingDir: join(STORE_DIR, dir),
        files: files.map((f) => ({ path: f.path, sha256: sha256(f.content), kind: f.kind })), report, verification,
      };
      this.store.writeJson(join('generated', `${target}-${dialect}`, 'manifest.json'), manifest);
      const fresh = this.load();
      this.moveTo(fresh, 'GENERATED');
      fresh.history.push({ revision: fresh.status.revision, at: nowIso(), author: 'manual', summary: `Artefatos gerados: ${target}/${dialect}`, hash });
      this.store.writeJson('model.json', fresh);
      if (verification.some((v) => v.status === 'failed')) manifest.report.warnings.push('Verificação falhou: ' + verification.filter((v) => v.status === 'failed').map((v) => v.detail).join('; '));
      return manifest;
    } catch (e) {
      const fresh = this.load();
      fresh.status.failure = (e as Error).message;
      this.moveTo(fresh, 'FAILED');
      this.store.writeJson('model.json', fresh);
      throw e;
    }
  }

  manifest(target: string, dialect: string): GenerationManifest | undefined {
    return this.store.readJson<GenerationManifest>(join('generated', `${target}-${dialect}`, 'manifest.json'));
  }

  private stagedFiles(man: GenerationManifest): GeneratedFile[] {
    return man.files.map((f) => ({ path: f.path, kind: f.kind as GeneratedFile['kind'], content: readFileSync(join(this.store.root, man.stagingDir, f.path), 'utf8') }));
  }

  /** Reviewable plan: what would be written and the diff for files that already exist. Writes nothing. */
  planApply(target: string, dialect: string, outDir = '.'): ApplyPlanItem[] {
    const man = this.manifest(target, dialect);
    if (!man) throw new EngineError('NOT_GENERATED', 'Nada gerado para este alvo.');
    if (man.modelHash !== this.currentHash()) throw new EngineError('STALE', 'Os artefatos foram gerados de uma versão anterior do modelo. Gere novamente.');
    return this.stagedFiles(man).map((f) => {
      const rel = join(outDir, f.path).split('\\').join('/').replace(/^\.\//, '');
      let abs: string;
      try { abs = safeResolve(this.root, rel); } catch (e) { return { path: rel, status: 'blocked' as const, reason: (e as Error).message }; }
      if (abs.includes(`/${STORE_DIR}/`)) return { path: rel, status: 'blocked' as const, reason: 'destino dentro da pasta de metadados' };
      if (!existsSync(abs)) return { path: rel, status: 'new' as const };
      const old = readFileSync(abs, 'utf8');
      if (old === f.content) return { path: rel, status: 'unchanged' as const };
      if (MIGRATION_PATH.test(rel)) return { path: rel, status: 'blocked' as const, reason: 'migrations existentes nunca são sobrescritas', diff: unifiedDiff(old, f.content, rel) };
      return { path: rel, status: 'modified' as const, diff: unifiedDiff(old, f.content, rel) };
    });
  }

  /**
   * Writes staged artifacts into the project. Separate from model approval: requires explicit `authorize: true`.
   * Existing files are only replaced with `overwrite: true`; migrations are never replaced.
   */
  apply(target: string, dialect: string, opts: { authorize: boolean; outDir?: string; overwrite?: boolean }): GenerationManifest {
    if (!opts.authorize) throw new EngineError('NOT_AUTHORIZED', 'Gravar no projeto exige autorização explícita (authorize=true), separada da aprovação do modelo.');
    const plan = this.planApply(target, dialect, opts.outDir);
    const man = this.manifest(target, dialect)!;
    const files = new Map(this.stagedFiles(man).map((f) => [join(opts.outDir ?? '.', f.path).split('\\').join('/').replace(/^\.\//, ''), f]));
    const written: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const item of plan) {
      if (item.status === 'unchanged') continue;
      if (item.status === 'blocked') { skipped.push({ path: item.path, reason: item.reason ?? 'bloqueado' }); continue; }
      if (item.status === 'modified' && !opts.overwrite) { skipped.push({ path: item.path, reason: 'arquivo existente; revise o diff e reexecute com overwrite' }); continue; }
      const abs = safeResolve(this.root, item.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, files.get(item.path)!.content);
      written.push(item.path);
    }
    man.applied = { at: nowIso(), written, skipped };
    this.store.writeJson(join('generated', `${target}-${dialect}`, 'manifest.json'), man);
    return man;
  }

  // ---- summaries ----------------------------------------------------------------------------

  status() {
    const m = this.load();
    const approval = this.hasValidApproval(m);
    return {
      project: m.project.name, mode: m.project.mode, state: m.status.state, revision: m.status.revision, hash: modelHash(m),
      counts: { entities: m.entities.length, relationships: m.relationships.length, concepts: m.domain.concepts.length, contracts: m.contracts.length, enums: m.enums.length },
      pending: {
        questions: m.questions.filter((q) => q.status === 'open').length,
        critical: m.questions.filter((q) => q.impact === 'critical' && q.status === 'open').length,
        hypotheses: m.hypotheses.filter((h) => h.status === 'unconfirmed').length,
      },
      approval: approval ? { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, revision: approval.revision } : null,
      domainApproved: m.approvals.some((a) => a.stage === 'domain' && !a.invalidatedAt),
      profile: m.project.profile,
      lastValidation: m.status.lastValidation ?? null,
      versions: this.store.listVersions(),
    };
  }

  list(dir: string): string[] {
    const abs = safeResolve(this.root, dir);
    return readdirSync(abs);
  }

  rules() {
    return allRules.map((r) => ({ id: r.id, category: r.category, description: r.description }));
  }
}

function uniqueSourceId(m: CanonicalModel, rel: string): string {
  let id = `src_${slug(rel)}`.slice(0, 100);
  let i = 2;
  while (m.sources.some((s) => s.id === id)) id = `src_${slug(rel)}`.slice(0, 95) + `_${i++}`;
  return id;
}

export { InvalidTransitionError };
