import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { emptyFacts, type Analyzer, type Facts, type ScannedFile } from '@dbarchitect/core';

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', 'vendor', 'packages-cache', '.idea', '.vs', '.gradle', 'coverage', '.database-architect', '.turbo', '.cache']);

/** Files never read: secrets, keys, certificates. Matching is by name only — content is never inspected. */
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|pfx|p12|jks|keystore|crt|cer)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|secrets?\.(json|ya?ml)|\.npmrc|\.netrc|appsettings\.(production|prod)\.json)$/i;
const TEXT_EXT = /\.(cs|csproj|sln|props|targets|json|ya?ml|prisma|sql|md|markdown|txt|ts|tsx|js|mjs|cjs|py|java|kt|php|rb|go|config|xml|toml|ini|cshtml|razor|http)$/i;
const MAX_BYTES = 1_000_000;

export interface ScanOptions {
  /** Extra directory names to skip. */
  ignore?: string[];
  maxFiles?: number;
}

export interface CoverageReport {
  root: string;
  filesVisited: number;
  filesRead: number;
  skipped: { ignoredDirs: string[]; secretFiles: string[]; tooLarge: string[]; nonText: number };
  byAnalyzer: Record<string, { accepted: number }>;
  /** Relevant-looking files no analyzer understood. */
  uninterpreted: Array<{ file: string; reason: string }>;
  truncated: boolean;
}

export interface ScanResult {
  facts: Facts;
  coverage: CoverageReport;
}

export function collectFiles(root: string, opts: ScanOptions = {}): { files: ScannedFile[]; coverage: CoverageReport } {
  const real = realpathSync(root);
  const ignore = new Set([...IGNORED_DIRS, ...(opts.ignore ?? [])]);
  const max = opts.maxFiles ?? 20_000;
  const files: ScannedFile[] = [];
  const cov: CoverageReport = { root: real, filesVisited: 0, filesRead: 0, skipped: { ignoredDirs: [], secretFiles: [], tooLarge: [], nonText: 0 }, byAnalyzer: {}, uninterpreted: [], truncated: false };
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, ent.name);
      const rel = relative(real, abs).split(sep).join('/');
      // Symlinks are never followed: they could point outside the authorized root.
      if (lstatSync(abs).isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (ignore.has(ent.name)) { cov.skipped.ignoredDirs.push(rel); continue; }
        walk(abs);
      } else if (ent.isFile()) {
        cov.filesVisited++;
        if (cov.filesVisited > max) { cov.truncated = true; return; }
        if (SECRET_FILE.test(rel)) { cov.skipped.secretFiles.push(rel); continue; }
        if (!TEXT_EXT.test(ent.name)) { cov.skipped.nonText++; continue; }
        if (lstatSync(abs).size > MAX_BYTES) { cov.skipped.tooLarge.push(rel); continue; }
        files.push({ path: rel, content: readFileSync(abs, 'utf8') });
      }
    }
  };
  walk(real);
  cov.filesRead = files.length;
  return { files, coverage: cov };
}

function merge(into: Facts, part: Partial<Facts>): void {
  for (const k of Object.keys(part) as Array<keyof Facts>) {
    const v = part[k];
    if (Array.isArray(v)) (into[k] as unknown[]).push(...v);
  }
}

/** Looks like it should have been understood (persistence-related) but nobody claimed it. */
const RELEVANT = /(DbContext|\[Table\(|\[Key\]|modelBuilder|@Entity\(|sequelize\.define|Model\.init|CREATE\s+TABLE|openapi|swagger|\$schema)/i;

export function scan(root: string, analyzers: Analyzer[], opts: ScanOptions = {}): ScanResult {
  const { files, coverage } = collectFiles(root, opts);
  const facts = emptyFacts();
  const claimed = new Set<string>();
  for (const a of analyzers) {
    const mine = files.filter((f) => a.accepts(f.path));
    coverage.byAnalyzer[a.id] = { accepted: mine.length };
    if (!mine.length) continue;
    try {
      merge(facts, a.analyze(mine));
      for (const f of mine) claimed.add(f.path);
    } catch (err) {
      facts.unparsed.push({ file: `(analyzer ${a.id})`, reason: `Analyzer failed: ${(err as Error).message}` });
    }
  }
  facts.documents.forEach((d) => claimed.add(d.file));
  for (const f of files)
    if (!claimed.has(f.path) && RELEVANT.test(f.content.slice(0, 200_000)))
      coverage.uninterpreted.push({ file: f.path, reason: 'Parece relacionado a persistência/contratos, mas nenhum analisador suporta este formato.' });
  coverage.uninterpreted.push(...facts.unparsed);
  return { facts, coverage };
}
