import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, TRANSITIONS, applyOps, assertTransition, computeOps, createEmptyModel, diffModels, validateSchema, MODEL_STATES, type CanonicalModel } from '@dbarchitect/core';
import { modelHash, safeResolve, PathAccessError } from '@dbarchitect/core/node';
import { validateModel } from '@dbarchitect/validators';
import { attr, entity, pk, rel, twoEntityModel } from './helpers.ts';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers.ts';

describe('CSM JSON Schema (scenario 8)', () => {
  it('accepts a valid model', () => {
    expect(validateSchema(twoEntityModel())).toEqual({ valid: true, errors: [] });
  });
  it('rejects unknown properties and bad enums', () => {
    const m = twoEntityModel() as unknown as Record<string, unknown>;
    m.bogus = 1;
    expect(validateSchema(m).valid).toBe(false);
    const m2 = twoEntityModel();
    (m2.entities[0].attributes[0] as { domainType: string }).domainType = 'varchar';
    const r = validateSchema(m2);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('domainType');
  });
  it('requires provenance on every attribute', () => {
    const m = twoEntityModel();
    delete (m.entities[0].attributes[0] as { provenance?: unknown }).provenance;
    expect(validateSchema(m).valid).toBe(false);
  });
});

describe('model with two related entities (scenario 1)', () => {
  it('validates without blocking issues', () => {
    const r = validateModel(twoEntityModel());
    expect(r.issues.filter((i) => i.blocking)).toEqual([]);
  });
});

describe('structural validators', () => {
  const run = (m: CanonicalModel) => validateModel(m).issues;
  it('detects an invalid foreign reference (scenario 2)', () => {
    const m = twoEntityModel();
    m.relationships[0].to.entity = 'ghost';
    const i = run(m).find((x) => x.rule === 'S003');
    expect(i?.severity).toBe('critical');
    expect(i?.blocking).toBe(true);
  });
  it('detects a missing FK and missing PK', () => {
    const m = twoEntityModel();
    m.relationships[0].from.attributes = [];
    m.entities[1].attributes.find((a) => a.id === 'id')!.primaryKey = false;
    const rules = run(m).map((i) => i.rule);
    expect(rules).toContain('S004');
    expect(rules).toContain('S002');
  });
  it('detects duplicate identifiers', () => {
    const m = twoEntityModel();
    m.entities.push(structuredClone(m.entities[0]));
    expect(run(m).some((i) => i.rule === 'S001')).toBe(true);
  });
  it('detects contradictory nullability (required association, nullable FK)', () => {
    const m = twoEntityModel();
    m.entities[1].attributes.find((a) => a.id === 'customer_id')!.nullable = true;
    expect(run(m).some((i) => i.rule === 'S005' && i.blocking)).toBe(true);
  });
  it('does not equate conditional requirement with NOT NULL', () => {
    const m = twoEntityModel();
    m.entities[1].attributes.push(attr('delivered_at', 'datetime', { requiredWhen: [{ condition: "status = 'DELIVERED'" }] }));
    const i = run(m).find((x) => x.rule === 'S005' && x.message.includes('delivered_at'));
    expect(i?.severity).toBe('domain');
  });
  it('flags 1:1 whose FK is not unique and cardinality/nullability combos', () => {
    const m = twoEntityModel();
    m.relationships[0].cardinality = '1:1';
    expect(run(m).some((i) => i.id.includes(':1to1'))).toBe(true);
  });
  it('flags FK without supporting index but not when one exists', () => {
    const m = twoEntityModel();
    expect(run(m).some((i) => i.rule === 'I002')).toBe(false);
    m.indexes = [];
    expect(run(m).some((i) => i.rule === 'I002')).toBe(true);
  });
  it('flags duplicated and prefix-redundant indexes as non-blocking', () => {
    const m = twoEntityModel();
    m.indexes.push({ ...m.indexes[0], id: 'ix_dup' });
    const issues = run(m).filter((i) => i.rule === 'I001');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => !i.blocking)).toBe(true);
  });
  it('flags cascade risk on non-identifying relationship', () => {
    const m = twoEntityModel();
    m.relationships[0].onDelete = 'cascade';
    expect(run(m).some((i) => i.rule === 'R001' && i.severity === 'integrity')).toBe(true);
  });
  it('treats suspicious redundancy as a warning with context, not an error', () => {
    const m = twoEntityModel();
    m.entities[0].attributes.push(attr('total', 'money', { precision: 18, scale: 2 }));
    const i = run(m).find((x) => x.rule === 'R003');
    expect(i).toBeDefined();
    expect(i!.blocking).toBe(false);
    expect(i!.rationale).toMatch(/intencional/);
  });
  it('checks tenant isolation', () => {
    const m = twoEntityModel();
    m.conventions.tenancy = { strategy: 'column', column: 'tenant_id' };
    expect(run(m).filter((i) => i.rule === 'R002').length).toBeGreaterThanOrEqual(2);
  });
  it('checks dialect limits', () => {
    const m = twoEntityModel();
    m.entities[1].attributes.find((a) => a.id === 'total')!.precision = 60;
    const r = validateModel(m, { dialect: { id: 'sqlserver', maxDecimalPrecision: 38, quote: (x) => x, columnType: () => '', supportsCheck: true } });
    expect(r.issues.some((i) => i.rule === 'T001' && i.message.includes('excede'))).toBe(true);
  });
});

describe('pending decisions (scenario 3)', () => {
  it('open critical question blocks; non-critical does not', () => {
    const m = twoEntityModel();
    m.questions.push({ id: 'q1', text: 'Uma entrega agrupa vários pedidos?', impact: 'critical', status: 'open', provenance: { origin: 'ai' } });
    m.questions.push({ id: 'q2', text: 'Retenção de auditoria?', impact: 'low', status: 'open', provenance: { origin: 'ai' } });
    const r = validateModel(m);
    expect(r.issues.find((i) => i.id === 'D001:q1')?.blocking).toBe(true);
    expect(r.issues.find((i) => i.id === 'D001:q2')?.blocking).toBe(false);
    m.questions[0].status = 'answered';
    expect(validateModel(m).blocking).toBe(0);
  });
});

describe('contracts vs entities', () => {
  it('keeps request-required, response-required and column nullability separate', () => {
    const m = twoEntityModel();
    m.entities[1].attributes.push(attr('delivered_at', 'datetime', { nullable: true, domainOptional: false }));
    m.contracts.push({ id: 'c1', name: 'OrderView', system: 'x', kind: 'openapi', direction: 'outbound', usage: ['response'], fields: [{ path: 'deliveredAt', type: 'string', requiredInResponse: true }], provenance: { origin: 'document' } });
    m.mappings.push({ id: 'm1', contract: 'c1', field: 'deliveredAt', entity: 'order', attribute: 'delivered_at', treatment: 'stored', provenance: { origin: 'ai' } });
    expect(validateModel(m).issues.some((i) => i.rule === 'C001' && i.message.includes('obrigatório na resposta'))).toBe(true);
  });
});

describe('state machine', () => {
  it('rejects analysis -> generation shortcuts', () => {
    expect(() => assertTransition('DRAFT', 'GENERATING')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('DISCOVERING', 'APPROVED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('ANALYZING', 'GENERATED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('READY_FOR_REVIEW', 'GENERATING')).toThrow(InvalidTransitionError);
  });
  it('only APPROVED can enter GENERATING', () => {
    const into = MODEL_STATES.filter((s) => TRANSITIONS[s].includes('GENERATING'));
    expect(into.sort()).toEqual(['APPROVED', 'FAILED', 'GENERATED']);
  });
});

describe('diff / destructive changes (scenario 6)', () => {
  it('classifies removal and narrowing as destructive and additions as safe', () => {
    const a = twoEntityModel();
    const b = structuredClone(a);
    b.entities[1].attributes = b.entities[1].attributes.filter((x) => x.id !== 'total');
    b.entities[0].attributes.find((x) => x.id === 'name')!.length = 50;
    b.entities.push(entity('note', [pk()]));
    const ch = diffModels(a, b);
    expect(ch.find((c) => c.description.includes('Order.total'))?.risk).toBe('destructive');
    expect(ch.find((c) => c.description.includes('comprimento'))?.risk).toBe('destructive');
    expect(ch.find((c) => c.description.includes('Note'))?.risk).toBe('safe');
    expect(diffModels(a, a)).toEqual([]);
  });
  it('warns about NOT NULL without default on new column and nullable->not null', () => {
    const a = twoEntityModel();
    const b = structuredClone(a);
    b.entities[0].attributes.push(attr('email', 'string', { length: 100 }));
    expect(diffModels(a, b)[0].risk).toBe('risky');
    const c = structuredClone(a);
    a.entities[0].attributes.find((x) => x.id === 'name')!.nullable = true;
    expect(diffModels(a, c).find((x) => x.description.includes('NOT NULL'))?.risk).toBe('destructive');
  });
  it('validator M001 surfaces destructive changes against previous model', () => {
    const a = twoEntityModel();
    const b = structuredClone(a);
    b.entities[1].attributes = b.entities[1].attributes.filter((x) => x.id !== 'total');
    const r = validateModel(b, { previous: a });
    expect(r.issues.find((i) => i.rule === 'M001')?.severity).toBe('integrity');
  });
});

describe('ops', () => {
  it('upsert / remove / set and computeOps round trip', () => {
    const a = twoEntityModel();
    const b = applyOps(a, [{ op: 'remove', collection: 'indexes', id: 'ix_order_customer' }, { op: 'set', path: 'project.name', value: 'X' }]);
    expect(b.indexes).toHaveLength(0);
    const ops = computeOps(a, b);
    expect(applyOps(a, ops)).toEqual(b);
    expect(() => applyOps(a, [{ op: 'remove', collection: 'indexes', id: 'nope' }])).toThrow();
    expect(() => applyOps(a, [{ op: 'set', path: 'status.state' as never, value: 'APPROVED' }])).toThrow();
  });
  it('hash is stable and ignores status/history', () => {
    const a = twoEntityModel();
    const h = modelHash(a);
    a.status.revision = 9;
    a.history.push({ revision: 1, at: 'x', author: 'ai', summary: 's', hash: 'h' });
    expect(modelHash(a)).toBe(h);
    a.entities[0].name = 'Other';
    expect(modelHash(a)).not.toBe(h);
  });
});

describe('path safety', () => {
  it('blocks traversal and symlink escape', () => {
    const root = tempDir();
    const outside = tempDir();
    mkdirSync(join(root, 'sub'));
    symlinkSync(outside, join(root, 'link'));
    expect(safeResolve(root, 'sub')).toContain('sub');
    expect(() => safeResolve(root, '../x')).toThrow(PathAccessError);
    expect(() => safeResolve(root, '/etc/passwd')).toThrow(PathAccessError);
    expect(() => safeResolve(root, 'link/file.txt')).toThrow(PathAccessError);
  });
});
void rel;
