import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Layout } from '@dbarchitect/core/node';
import type { Op } from '@dbarchitect/core';
import { Engine, EngineError, SUPPORT, generators } from '@dbarchitect/engine';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STUDIO_DIST = join(HERE, '../../../apps/studio/dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2' };

export interface StudioServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000_000) throw new EngineError('TOO_LARGE', 'Corpo da requisição grande demais');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/** Local-only API + static Studio. Bound to 127.0.0.1; Host check blocks DNS rebinding; a per-run token blocks cross-site requests. */
export async function startStudioServer(root: string, opts: { port?: number; host?: string } = {}): Promise<StudioServer> {
  const engine = new Engine(root);
  const token = randomBytes(24).toString('hex');
  const host = opts.host ?? '127.0.0.1';
  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const server: Server = createServer(async (req, res) => {
    try {
      if (!allowedHosts().has(req.headers.host ?? '')) return send(res, 403, { error: 'host não permitido' });
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const given = Buffer.from(String(req.headers['x-dba-token'] ?? ''));
        const want = Buffer.from(token);
        if (given.length !== want.length || !timingSafeEqual(given, want)) return send(res, 401, { error: 'token inválido' });
        if (req.method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && !allowedHosts().has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'origem não permitida' });
        }
        return await api(req, res, url);
      }
      return serveStatic(res, url.pathname);
    } catch (e) {
      const err = e as EngineError & { errors?: string[] };
      const status = err.code === 'CONFLICT' ? 409 : err.code === 'NOT_AUTHORIZED' ? 403 : err.name === 'SyntaxError' ? 400 : err.code ? 422 : 500;
      send(res, status, { error: err.message, code: err.code, details: err.errors });
    }
  });

  function serveStatic(res: ServerResponse, pathname: string): void {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '') || 'index.html';
    let file = join(STUDIO_DIST, rel);
    if (!file.startsWith(STUDIO_DIST + sep) && file !== STUDIO_DIST) return send(res, 403, 'forbidden', 'text/plain');
    if (!existsSync(file) || !statSync(file).isFile()) file = join(STUDIO_DIST, 'index.html');
    if (!existsSync(file)) return send(res, 503, 'Studio não foi compilado. Execute: pnpm build', 'text/plain; charset=utf-8');
    let body: Buffer | string = readFileSync(file);
    if (file.endsWith('index.html')) body = body.toString('utf8').replace('</head>', `<meta name="dba-token" content="${token}"></head>`);
    send(res, 200, body, MIME[extname(file)] ?? 'application/octet-stream');
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const p = url.pathname.slice(5);
    const method = req.method ?? 'GET';
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    if (method === 'GET') {
      switch (p) {
        case 'model': {
          const model = engine.load();
          return send(res, 200, { model, hash: engine.currentHash(model), status: engine.status(), issues: engine.issues(), layout: engine.store.loadLayout(), baseline: engine.baseline() ?? null });
        }
        case 'status': return send(res, 200, engine.status());
        case 'versions': return send(res, 200, engine.store.listVersions().map((r) => { const m = engine.store.loadVersion(r); return { revision: r, at: m.status.updatedAt, state: m.status.state, entities: m.entities.length, summary: m.history.at(-1)?.summary }; }));
        case 'version': return send(res, 200, engine.store.loadVersion(Number(q('rev'))));
        case 'diff': return send(res, 200, engine.diff(q('from') ? Number(q('from')) : undefined, q('to') ? Number(q('to')) : undefined));
        case 'scan': return send(res, 200, engine.lastScan() ?? null);
        case 'support': return send(res, 200, { support: SUPPORT, generators: Object.values(generators).map((g) => ({ id: g.id, description: g.description, dialects: g.dialects })) });
        case 'rules': return send(res, 200, engine.rules());
        case 'plan': return send(res, 200, engine.planApply(q('target')!, q('dialect')!, q('outDir')));
        case 'manifest': return send(res, 200, engine.manifest(q('target')!, q('dialect')!) ?? null);
        default: return send(res, 404, { error: 'não encontrado' });
      }
    }
    if (method === 'PUT' && p === 'layout') { engine.store.saveLayout((await readBody(req)) as unknown as Layout); return send(res, 200, { ok: true }); }
    if (method !== 'POST') return send(res, 405, { error: 'método não permitido' });
    const body = await readBody(req);
    switch (p) {
      case 'ops': {
        const m = engine.applyOps(body.ops as Op[], { author: 'manual', summary: String(body.summary ?? 'Edição no Studio'), expectedRevision: body.expectedRevision as number | undefined });
        return send(res, 200, { revision: m.status.revision, state: m.status.state, hash: engine.currentHash(m) });
      }
      case 'validate': { const r = engine.validate(); return send(res, 200, { ...r, status: engine.status() }); }
      case 'fix': { const m = engine.applyFixes(body.fixes as Array<{ issueId: string; fixId: string }>, body.expectedRevision as number | undefined); return send(res, 200, { revision: m.status.revision, state: m.status.state }); }
      case 'approve': engine.approve(String(body.by ?? ''), body.note as string | undefined); return send(res, 200, engine.status());
      case 'approve-domain': engine.approveDomain(String(body.by ?? ''), body.note as string | undefined); return send(res, 200, engine.status());
      case 'scan': return send(res, 200, engine.scan());
      case 'import-scan': { const m = engine.importScan({ replace: body.replace === true }); return send(res, 200, { revision: m.status.revision, entities: m.entities.length }); }
      case 'import-docs': return send(res, 200, engine.importDocuments((body.paths as string[]) ?? []));
      case 'generate': return send(res, 200, engine.generate(String(body.target), { dialect: body.dialect as string | undefined, options: body.options as Record<string, unknown> | undefined }));
      case 'apply': return send(res, 200, engine.apply(String(body.target), String(body.dialect), { authorize: body.authorize === true, outDir: body.outDir as string | undefined, overwrite: body.overwrite === true }));
      default: return send(res, 404, { error: 'não encontrado' });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, port, token, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
