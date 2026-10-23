// Node-only helpers: hashing, path safety and the on-disk store (.database-architect/).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CanonicalModel } from './types.ts';
import { canonicalJson, domainProjection, hashableProjection } from './model.ts';
import { assertSchema } from './schema.ts';

export const STORE_DIR = '.database-architect';

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function modelHash(model: CanonicalModel): string {
  return sha256(canonicalJson(hashableProjection(model)));
}

export function domainHash(model: CanonicalModel): string {
  return sha256(canonicalJson(domainProjection(model)));
}

export class PathAccessError extends Error {}

/** Resolves `p` against `root` and refuses anything that escapes it (including through symlinks). */
export function safeResolve(root: string, p: string): string {
  const rootReal = realpathSync(root);
  const abs = isAbsolute(p) ? resolve(p) : resolve(rootReal, p);
  let check = abs;
  // Walk up to the nearest existing ancestor so symlinks are resolved even for files not yet created.
  while (!existsSync(check) && dirname(check) !== check) check = dirname(check);
  const real = join(realpathSync(check), relative(check, abs));
  const rel = relative(rootReal, real);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new PathAccessError(`Path outside the authorized root: ${p}`);
  return real;
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export interface Layout {
  domain: Record<string, { x: number; y: number }>;
  data: Record<string, { x: number; y: number }>;
}

/** File-based store. Everything is plain JSON so it can be versioned in git and reviewed. */
export class Store {
  readonly root: string;
  readonly dir: string;
  constructor(root: string) {
    this.root = realpathSync(root);
    this.dir = join(this.root, STORE_DIR);
  }
  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }
  exists(): boolean {
    return existsSync(this.path('model.json'));
  }
  readJson<T>(name: string): T | undefined {
    const f = this.path(name);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : undefined;
  }
  writeJson(name: string, value: unknown): void {
    writeAtomic(this.path(name), JSON.stringify(value, null, 2) + '\n');
  }
  writeText(name: string, value: string): void {
    writeAtomic(this.path(name), value);
  }
  loadModel(): CanonicalModel {
    const m = this.readJson<unknown>('model.json');
    if (!m) throw new Error(`No modeling session in ${this.root}. Run "dbarchitect init" first.`);
    assertSchema(m);
    return m;
  }
  /** Persists the model and a snapshot of this revision under versions/. */
  saveModel(model: CanonicalModel): void {
    assertSchema(model);
    this.writeJson('model.json', model);
    this.writeJson(`versions/r${String(model.status.revision).padStart(4, '0')}.json`, model);
  }
  listVersions(): number[] {
    const d = this.path('versions');
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .map((f) => /^r(\d+)\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b);
  }
  loadVersion(rev: number): CanonicalModel {
    const m = this.readJson<CanonicalModel>(`versions/r${String(rev).padStart(4, '0')}.json`);
    if (!m) throw new Error(`Revision ${rev} not found`);
    return m;
  }
  loadLayout(): Layout {
    return this.readJson<Layout>('layout.json') ?? { domain: {}, data: {} };
  }
  saveLayout(layout: Layout): void {
    this.writeJson('layout.json', layout);
  }
}
