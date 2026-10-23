import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Op } from '@dbarchitect/core';
import { Engine, EngineError, SUPPORT, generators } from '@dbarchitect/engine';
import { startStudioServer, type StudioServer } from '@dbarchitect/cli/server';

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown): Result => {
  const x = e as Error & { code?: string; errors?: string[] };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: x.message, code: x.code, details: x.errors?.slice(0, 10) }, null, 2) }] };
};

/**
 * Builds the MCP server. The authorized root is fixed at start (never a tool argument), so tools cannot be pointed at other paths.
 * There is deliberately no tool to approve a model and no generic command/file tool: approval is a human act in the Studio or CLI.
 */
export function createServer(root: string): { server: McpServer; close: () => Promise<void> } {
  const engine = new Engine(root);
  let studio: StudioServer | undefined;
  const server = new McpServer({ name: 'database-architect', version: '0.1.0' });
  const wrap = <A,>(fn: (a: A) => unknown | Promise<unknown>) => async (a: A): Promise<Result> => { try { return ok(await fn(a)); } catch (e) { return fail(e); } };

  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const writesMeta = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool('init_session', {
    title: 'Create modeling session',
    description: 'Creates .database-architect/ metadata in the authorized project (greenfield, brownfield or evolution). Writes only tool metadata; no entities, ORM or database are chosen.',
    inputSchema: { mode: z.enum(['greenfield', 'brownfield', 'evolution']), name: z.string().optional(), description: z.string().optional().describe('Business description in the user\'s own words (greenfield).') },
    annotations: writesMeta,
  }, wrap(({ mode, name, description }) => { const m = engine.init({ mode, name, description }); return { state: m.status.state, project: m.project.name, mode: m.project.mode }; }));

  server.registerTool('inspect_project', {
    title: 'Scan authorized repository',
    description: 'Read-only structural scan of the authorized root (languages, ORMs, entities, relations, migrations, OpenAPI/JSON Schema/SQL DDL, docs). Skips dependency/build dirs and secret files; never executes project code. Returns facts, limitations and coverage. Does not change the model.',
    inputSchema: {},
    annotations: writesMeta,
  }, wrap(() => { if (!engine.hasSession()) engine.init({ mode: 'brownfield' }); const s = engine.scan(); return summarizeScan(s); }));

  server.registerTool('get_analysis_summary', {
    title: 'Last scan summary', description: 'Summary of the last scan (technologies, tables, relations, contracts, conflicts, files that could not be interpreted).', inputSchema: {}, annotations: readOnly,
  }, wrap(() => { const s = engine.lastScan(); return s ? summarizeScan(s) : { message: 'Nenhum scan. Use inspect_project.' }; }));

  server.registerTool('import_scan_facts', {
    title: 'Import code facts into the model',
    description: 'Converts the latest scan into model elements marked origin "code" with file/line evidence (brownfield/evolution). Semantic interpretation is NOT done here: add domain rules and hypotheses separately with propose_model_ops using origin "ai".',
    inputSchema: {}, annotations: writesMeta,
  }, wrap(() => { const m = engine.importScan(); return { revision: m.status.revision, entities: m.entities.length, relationships: m.relationships.length, openQuestions: m.questions.filter((q) => q.status === 'open').length, state: m.status.state }; }));

  server.registerTool('import_documents', {
    title: 'Import documents and contracts',
    description: 'Registers requirement documents, OpenAPI and JSON Schema files (paths relative to the authorized root) as sources; API schemas become contracts. Contract objects are NOT turned into tables.',
    inputSchema: { paths: z.array(z.string()).min(1).max(50) }, annotations: writesMeta,
  }, wrap(({ paths }) => engine.importDocuments(paths)));

  server.registerTool('get_model', {
    title: 'Read the canonical model',
    description: 'Returns the canonical model. detail=summary (default) lists entities/relationships compactly; detail=full returns the whole JSON.',
    inputSchema: { detail: z.enum(['summary', 'full']).optional() }, annotations: readOnly,
  }, wrap(({ detail }) => {
    const m = engine.load();
    if (detail === 'full') return m;
    return {
      status: engine.status(),
      domain: { problem: m.domain.problem, actors: m.domain.actors.map((a) => a.name), concepts: m.domain.concepts.map((c) => ({ id: c.id, name: c.name, kind: c.kind, mapsToEntity: c.mapsToEntity })), rules: m.domain.rules.length, glossary: m.domain.glossary.length },
      entities: m.entities.map((e) => ({ id: e.id, name: e.name, table: e.table, origin: e.provenance.origin, attributes: e.attributes.map((a) => `${a.id}:${a.domainType}${a.nullable ? '?' : ''}${a.primaryKey ? '#' : ''}`) })),
      relationships: m.relationships.map((r) => `${r.id}: ${r.from.entity}(${r.from.attributes}) ${r.cardinality}${r.required ? '' : ' (optional)'} ${r.to.entity} onDelete=${r.onDelete}`),
      contracts: m.contracts.map((c) => `${c.id} (${c.system}, ${c.fields.length} fields)`),
      enums: m.enums.map((e) => e.id),
    };
  }));

  server.registerTool('propose_model_ops', {
    title: 'Create or update the candidate model',
    description: 'Applies validated operations (upsert/remove on model collections, set on allowed paths) to the candidate model. Items must carry provenance {origin: user|document|code|ai, rationale, evidence}. Origin "code" requires file evidence; inferences must use "ai". Any change invalidates approvals. Schema-invalid results are rejected.',
    inputSchema: {
      ops: z.array(z.object({
        op: z.enum(['upsert', 'remove', 'set']),
        collection: z.string().optional().describe('entities | relationships | enums | indexes | contracts | mappings | queries | decisions | questions | hypotheses | sources | domain.actors | domain.requirements | domain.glossary | domain.concepts | domain.conceptRelations | domain.rules | domain.lifecycles | domain.events | domain.contexts'),
        item: z.record(z.string(), z.unknown()).optional(), id: z.string().optional(), path: z.string().optional(), value: z.unknown().optional(),
      })).min(1),
      summary: z.string().optional(),
    },
    annotations: writesMeta,
  }, wrap(({ ops, summary }) => { const m = engine.applyOps(ops as unknown as Op[], { author: 'ai', summary }); return { revision: m.status.revision, state: m.status.state, hash: engine.currentHash(m) }; }));

  server.registerTool('get_pending', {
    title: 'Open questions, hypotheses and pending decisions',
    description: 'Lists unresolved questions (by impact), unconfirmed hypotheses and the latest pending-decision issues. Do not fill these gaps with silent assumptions; ask the user or record a hypothesis.',
    inputSchema: {}, annotations: readOnly,
  }, wrap(() => { const m = engine.load(); return { questions: m.questions.filter((q) => q.status !== 'answered'), hypotheses: m.hypotheses.filter((h) => h.status === 'unconfirmed'), domainApproved: engine.status().domainApproved }; }));

  server.registerTool('validate_model', {
    title: 'Run deterministic validators',
    description: 'Runs structural, type, index, integrity, domain, contract, performance and migration-risk rules (no AI). Updates the workflow state: READY_FOR_REVIEW only if there are no blocking issues.',
    inputSchema: {}, annotations: writesMeta,
  }, wrap(() => { const r = engine.validate(); return { state: engine.status().state, blocking: r.blocking, bySeverity: r.bySeverity, issues: r.issues.slice(0, 80).map((i) => ({ rule: i.rule, severity: i.severity, blocking: i.blocking, message: i.message, recommendation: i.recommendation })) }; }));

  server.registerTool('get_diff', {
    title: 'Model differences', description: 'Semantic diff with migration risk (safe/risky/destructive). Default: current model vs baseline (brownfield/evolution) or previous revision.',
    inputSchema: { from: z.number().int().optional(), to: z.number().int().optional() }, annotations: readOnly,
  }, wrap(({ from, to }) => engine.diff(from, to)));

  server.registerTool('open_studio', {
    title: 'Open the Studio', description: 'Starts (or reuses) the local Studio on 127.0.0.1 and returns the URL for the user to review, edit and approve the model. Tries to open the browser; always returns the URL.',
    inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, wrap(async () => {
    if (!engine.hasSession()) engine.init({ mode: 'greenfield' });
    studio ??= await startStudioServer(root);
    try { spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', studio.url] : [studio.url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* URL returned anyway */ }
    return { url: studio.url, note: 'Peça ao usuário para revisar e aprovar no Studio. A aprovação não é feita pelo Claude.' };
  }));

  server.registerTool('get_approval_state', {
    title: 'Approval state', description: 'Whether the CURRENT model version has a valid approval (bound to hash and revision), plus state, blocking counts and domain-stage approval.',
    inputSchema: {}, annotations: readOnly,
  }, wrap(() => engine.status()));

  server.registerTool('generate_artifacts', {
    title: 'Generate artifacts into staging',
    description: 'Requires a valid approval of the current model hash and a confirmed technology profile. Generates into .database-architect/generated/ ONLY; the project is not modified. Targets: ' + Object.keys(generators).join(', ') + '. See get_support_matrix.',
    inputSchema: { target: z.enum(['sql', 'prisma', 'ef-core', 'dapper']), dialect: z.enum(['postgresql', 'sqlserver', 'sqlite', 'mysql']).optional(), namespace: z.string().optional() },
    annotations: writesMeta,
  }, wrap(({ target, dialect, namespace }) => engine.generate(target, { dialect, options: namespace ? { namespace } : {} })));

  server.registerTool('plan_apply_artifacts', {
    title: 'Preview project changes', description: 'Shows which files would be created or changed in the project and a unified diff for existing files. Writes nothing. Existing migrations are always blocked.',
    inputSchema: { target: z.enum(['sql', 'prisma', 'ef-core', 'dapper']), dialect: z.enum(['postgresql', 'sqlserver', 'sqlite', 'mysql']), outDir: z.string().optional() }, annotations: readOnly,
  }, wrap(({ target, dialect, outDir }) => engine.planApply(target, dialect, outDir)));

  server.registerTool('apply_artifacts', {
    title: 'Write generated artifacts into the project',
    description: 'MODIFIES PROJECT FILES. Only call after showing the plan_apply_artifacts diff to the user and receiving their explicit instruction to write. Requires userAuthorizedWrite=true. Existing files are replaced only with overwrite=true; migrations are never replaced. Does not run migrations or touch any database.',
    inputSchema: { target: z.enum(['sql', 'prisma', 'ef-core', 'dapper']), dialect: z.enum(['postgresql', 'sqlserver', 'sqlite', 'mysql']), outDir: z.string().optional(), userAuthorizedWrite: z.boolean().describe('Must be true, set only because the user explicitly asked to write.'), overwrite: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, wrap(({ target, dialect, outDir, userAuthorizedWrite, overwrite }) => engine.apply(target, dialect, { authorize: userAuthorizedWrite === true, outDir, overwrite })));

  server.registerTool('get_support_matrix', {
    title: 'Real support matrix', description: 'Target × dialect combinations implemented and how each is verified.', inputSchema: {}, annotations: readOnly,
  }, wrap(() => SUPPORT));

  return { server, close: async () => { await studio?.close(); await server.close(); } };
}

function summarizeScan(s: ReturnType<Engine['scan']>) {
  return {
    technologies: [...new Set(s.facts.technologies.map((t) => `${t.kind}:${t.name}${t.version ? ' ' + t.version : ''}`))],
    tables: s.facts.tables.map((t) => ({ table: t.name, entity: t.entityName, source: t.source, columns: t.columns.length })),
    relations: s.facts.relations.map((r) => `${r.fromTable}(${r.fromColumns}) → ${r.toTable}(${r.toColumns}) ${r.cardinality}${r.onDelete ? ' ' + r.onDelete : ''}`),
    enums: s.facts.enums.map((e) => e.name),
    contracts: s.facts.contracts.map((c) => `${c.name} [${c.system}] ${c.usage?.join('/') ?? '?'}`),
    migrations: s.facts.migrations.map((m) => `${m.tool}:${m.name}`),
    connectionsFound: s.facts.connections.map((c) => `${c.provider} (${c.key}, valor omitido)`),
    documents: s.facts.documents.map((d) => d.file),
    limitations: s.facts.limitations,
    coverage: { filesRead: s.coverage.filesRead, secretFilesSkipped: s.coverage.skipped.secretFiles.length, uninterpreted: s.coverage.uninterpreted },
  };
}

export async function run(): Promise<void> {
  const root = resolve(process.env.DBARCHITECT_PROJECT_ROOT || process.cwd());
  const { server } = createServer(root);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`database-architect MCP ready (root: ${root})\n`);
}

export { EngineError };
