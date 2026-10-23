import type { DomainType, Evidence, ScannedFile } from '@dbarchitect/core';

/** Shared C# source parsing helpers for the .NET analyzers (regex + brace matching; not a full parser). */
export const ev = (file: string, content: string, idx: number, source: 'code' = 'code', excerpt?: string): Evidence => ({
  source, file, line: content.slice(0, idx).split('\n').length, ...(excerpt ? { excerpt: excerpt.trim().slice(0, 200) } : {}),
});

export const CS_TYPES: Record<string, DomainType> = {
  string: 'string', int: 'integer', long: 'bigint', short: 'integer', decimal: 'decimal', double: 'decimal', float: 'decimal', bool: 'boolean',
  datetime: 'datetime', datetimeoffset: 'datetime', dateonly: 'date', timeonly: 'time', guid: 'uuid', 'byte[]': 'binary',
};

export interface ClassInfo { name: string; file: string; body: string; start: number; }

/** Brace-matched class bodies; regex alone cannot handle nested braces. */
export function classes(f: ScannedFile): ClassInfo[] {
  const out: ClassInfo[] = [];
  const re = /\b(?:public|internal)?\s*(?:sealed\s+|abstract\s+|partial\s+|static\s+)*(?:class|record)\s+([A-Za-z_]\w*)[^{;]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f.content))) {
    let depth = 1, i = m.index + m[0].length;
    while (i < f.content.length && depth) { const ch = f.content[i++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
    out.push({ name: m[1], file: f.path, body: f.content.slice(m.index + m[0].length, i - 1), start: m.index });
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}

export function snake(s: string): string { return s; }

export interface Prop { name: string; type: string; nullable: boolean; attrs: string[]; line: number; collection?: string }

export function props(c: ClassInfo, f: ScannedFile): Prop[] {
  const out: Prop[] = [];
  const re = /((?:\[[^\]]+\]\s*)*)public\s+(?:virtual\s+|required\s+)*([A-Za-z_][\w<>,\[\]\.?\s]*?)\s+([A-Za-z_]\w*)\s*\{\s*get;/g;
  let m: RegExpExecArray | null;
  const base = f.content.indexOf(c.body);
  while ((m = re.exec(c.body))) {
    const raw = m[2].trim();
    const coll = /^(?:ICollection|List|IList|HashSet|IEnumerable)<(\w+)>$/.exec(raw);
    out.push({ name: m[3], type: raw.replace(/\?$/, ''), nullable: raw.endsWith('?'), attrs: [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]), line: f.content.slice(0, base + m.index).split('\n').length, ...(coll ? { collection: coll[1] } : {}) });
  }
  return out;
}

export function propertyCfg(cfg: string, prop: string): string {
  const out: string[] = [];
  for (const m of cfg.matchAll(new RegExp(`Property\\(\\s*\\w+\\s*=>\\s*\\w+\\.${prop}\\s*\\)([^;]*);`, 'g'))) out.push(m[1]);
  return out.join(' ');
}

export function entityEnum(type: string, files: ScannedFile[]): boolean {
  return files.some((f) => new RegExp(`enum\\s+${type}\\b`).test(f.content));
}

