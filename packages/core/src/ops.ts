import type { CanonicalModel } from './types.ts';
import { canonicalJson } from './model.ts';

/** Collections an operation may target. Anything else (status, approvals, history) is engine-owned. */
export const COLLECTIONS = [
  'entities',
  'relationships',
  'enums',
  'indexes',
  'contracts',
  'mappings',
  'queries',
  'decisions',
  'questions',
  'hypotheses',
  'sources',
  'domain.actors',
  'domain.requirements',
  'domain.glossary',
  'domain.concepts',
  'domain.conceptRelations',
  'domain.rules',
  'domain.lifecycles',
  'domain.events',
  'domain.contexts',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const SETTABLE_PATHS = [
  'project.name',
  'project.description',
  'project.profile',
  'conventions',
  'domain.problem',
  'domain.goals',
] as const;
export type SettablePath = (typeof SETTABLE_PATHS)[number];

export type Op =
  | { op: 'upsert'; collection: Collection; item: { id: string } & Record<string, unknown> }
  | { op: 'remove'; collection: Collection; id: string }
  | { op: 'set'; path: SettablePath; value: unknown };

export class OpError extends Error {}

type Item = { id: string };

function getCollection(model: CanonicalModel, c: Collection): Item[] {
  const [a, b] = c.split('.');
  const container = (b ? (model as unknown as Record<string, Record<string, unknown>>)[a] : model) as Record<
    string,
    unknown
  >;
  const arr = container[b ?? a];
  if (!Array.isArray(arr)) throw new OpError(`Unknown collection ${c}`);
  return arr as Item[];
}

/**
 * Applies operations to a copy of the model. Schema validation of the result is the caller's job
 * (engine) so the Studio can apply ops optimistically with the same code.
 */
export function applyOps(model: CanonicalModel, ops: Op[]): CanonicalModel {
  const next = structuredClone(model);
  for (const op of ops) {
    if (op.op === 'set') {
      if (!SETTABLE_PATHS.includes(op.path)) throw new OpError(`Path not settable: ${String(op.path)}`);
      const [a, b] = op.path.split('.');
      const target = (b ? (next as unknown as Record<string, Record<string, unknown>>)[a] : next) as Record<
        string,
        unknown
      >;
      target[b ?? a] = structuredClone(op.value);
      continue;
    }
    if (!COLLECTIONS.includes(op.collection)) throw new OpError(`Unknown collection ${String(op.collection)}`);
    const arr = getCollection(next, op.collection);
    if (op.op === 'upsert') {
      if (!op.item || typeof op.item.id !== 'string') throw new OpError('upsert requires item.id');
      const i = arr.findIndex((x) => x.id === op.item.id);
      if (i >= 0) arr[i] = structuredClone(op.item);
      else arr.push(structuredClone(op.item));
    } else if (op.op === 'remove') {
      const i = arr.findIndex((x) => x.id === op.id);
      if (i < 0) throw new OpError(`${op.collection}: id not found ${op.id}`);
      arr.splice(i, 1);
    } else {
      throw new OpError(`Unknown op ${(op as { op: string }).op}`);
    }
  }
  return next;
}

/** Minimal op list turning `base` into `next` (used by the Studio to save a batch of edits). */
export function computeOps(base: CanonicalModel, next: CanonicalModel): Op[] {
  const ops: Op[] = [];
  for (const path of SETTABLE_PATHS) {
    const [a, b] = path.split('.');
    const get = (m: CanonicalModel) =>
      (b ? (m as unknown as Record<string, Record<string, unknown>>)[a][b] : (m as unknown as Record<string, unknown>)[a]);
    if (canonicalJson(get(base)) !== canonicalJson(get(next))) ops.push({ op: 'set', path, value: get(next) });
  }
  for (const c of COLLECTIONS) {
    const before = new Map(getCollection(base, c).map((x) => [x.id, x]));
    const after = getCollection(next, c);
    for (const item of after) {
      const prev = before.get(item.id);
      if (!prev || canonicalJson(prev) !== canonicalJson(item))
        ops.push({ op: 'upsert', collection: c, item: item as { id: string } & Record<string, unknown> });
      before.delete(item.id);
    }
    for (const id of before.keys()) ops.push({ op: 'remove', collection: c, id });
  }
  return ops;
}

/** Ops that remove an entity and every element that references it, so no dangling references remain. */
export function removeEntityOps(model: CanonicalModel, entityId: string): Op[] {
  const ops: Op[] = [];
  for (const r of model.relationships)
    if (r.from.entity === entityId || r.to.entity === entityId || r.through === entityId)
      ops.push({ op: 'remove', collection: 'relationships', id: r.id });
  for (const i of model.indexes) if (i.entity === entityId) ops.push({ op: 'remove', collection: 'indexes', id: i.id });
  for (const q of model.queries) if (q.entity === entityId) ops.push({ op: 'remove', collection: 'queries', id: q.id });
  for (const m of model.mappings)
    if (m.entity === entityId) ops.push({ op: 'remove', collection: 'mappings', id: m.id });
  ops.push({ op: 'remove', collection: 'entities', id: entityId });
  return ops;
}
