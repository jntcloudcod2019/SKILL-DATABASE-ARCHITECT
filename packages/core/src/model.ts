import type { Attribute, CanonicalModel, Entity, Mode, Provenance } from './types.ts';
import { CSM_FORMAT_VERSION } from './types.ts';

export function nowIso(): string {
  return new Date().toISOString();
}

/** Stable, readable identifier: "Order Item" -> "order_item". */
export function slug(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return s || 'item';
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function createEmptyModel(opts: {
  name: string;
  mode: Mode;
  rootDir: string;
  description?: string;
}): CanonicalModel {
  const at = nowIso();
  return {
    formatVersion: CSM_FORMAT_VERSION,
    project: {
      id: slug(opts.name),
      name: opts.name,
      mode: opts.mode,
      rootDir: opts.rootDir,
      ...(opts.description ? { description: opts.description } : {}),
      languages: [],
      frameworks: [],
      profile: { confirmed: false },
    },
    status: { state: 'DISCOVERING', revision: 0, updatedAt: at },
    approvals: [],
    conventions: {
      naming: 'snake_case',
      primaryKeyStrategy: 'undecided',
      tenancy: { strategy: 'undecided' },
    },
    sources: [],
    domain: {
      ...(opts.description ? { problem: opts.description } : {}),
      goals: [],
      actors: [],
      requirements: [],
      glossary: [],
      concepts: [],
      conceptRelations: [],
      rules: [],
      lifecycles: [],
      events: [],
      contexts: [],
    },
    entities: [],
    relationships: [],
    enums: [],
    indexes: [],
    contracts: [],
    mappings: [],
    queries: [],
    decisions: [],
    questions: [],
    hypotheses: [],
    history: [],
  };
}

/** The part of the model that approval covers. Status, history, approvals and sources do not change semantics. */
export function hashableProjection(model: CanonicalModel): unknown {
  return {
    formatVersion: model.formatVersion,
    profile: model.project.profile,
    conventions: model.conventions,
    domain: model.domain,
    entities: model.entities,
    relationships: model.relationships,
    enums: model.enums,
    indexes: model.indexes,
    contracts: model.contracts,
    mappings: model.mappings,
    queries: model.queries,
    decisions: model.decisions,
    questions: model.questions,
    hypotheses: model.hypotheses,
  };
}

export function domainProjection(model: CanonicalModel): unknown {
  return { domain: model.domain, questions: model.questions, hypotheses: model.hypotheses };
}

/** JSON with sorted keys, so semantically equal models hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function findEntity(model: CanonicalModel, id: string): Entity | undefined {
  return model.entities.find((e) => e.id === id);
}

export function findAttribute(entity: Entity | undefined, id: string): Attribute | undefined {
  return entity?.attributes.find((a) => a.id === id);
}

export function physicalTable(model: CanonicalModel, e: Entity): string {
  return e.table ?? applyNaming(e.name, model.conventions.naming);
}

export function physicalColumn(model: CanonicalModel, a: Attribute): string {
  return a.column ?? applyNaming(a.name, model.conventions.naming);
}

export function applyNaming(name: string, naming: CanonicalModel['conventions']['naming']): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (naming === 'snake_case') return words.map((w) => w.toLowerCase()).join('_');
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return naming === 'PascalCase' ? pascal : pascal[0].toLowerCase() + pascal.slice(1);
}

export function prov(origin: Provenance['origin'], rationale?: string): Provenance {
  return rationale ? { origin, rationale } : { origin };
}

export function validModelApproval(model: CanonicalModel, currentHash: string) {
  return model.approvals.find(
    (a) => a.stage === 'model' && !a.invalidatedAt && a.hash === currentHash,
  );
}
