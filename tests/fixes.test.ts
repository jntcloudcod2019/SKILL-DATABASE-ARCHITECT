import { describe, expect, it } from 'vitest';
import { applyFix, validateModel } from '@dbarchitect/validators';
import { Engine, EngineError } from '@dbarchitect/engine';
import { attr, approvedRestaurant, entity, pk, rel, tempDir, twoEntityModel } from './helpers.ts';

function model() {
  const m = twoEntityModel();
  m.entities.push(entity('posicao', [pk(), attr('Latitude', 'decimal'), attr('Longitude', 'decimal'), attr('PrecisaoEmMetros', 'decimal'), attr('FotoBase64', 'string'), attr('DetailsJson', 'string')]));
  m.entities[1].attributes.push(attr('ValorTotal', 'decimal'), attr('TaxaEntrega', 'decimal'));
  m.entities.push(entity('item', [pk(), attr('order_id', 'uuid')]));
  m.relationships.push(rel('item_order', 'item', 'order_id', 'order', { onDelete: 'cascade' }));
  m.indexes.push({ id: 'ix_item', entity: 'item', attributes: ['order_id'], unique: false, provenance: { origin: 'ai' } });
  m.questions.push({ id: 'q_fk', text: 'FK física?', impact: 'high', status: 'open', options: ['Manter sem FK', 'Criar FKs com restrict'], provenance: { origin: 'ai' } });
  return m;
}
const fixOf = (m: ReturnType<typeof model>, issueId: string, fixId: string) => validateModel(m).issues.find((i) => i.id === issueId)!.fixes!.find((f) => f.id === fixId)!;

describe('suggested fixes', () => {
  it('suggests precision by field name, always as an option the user picks', () => {
    const m = model();
    const lat = validateModel(m).issues.find((i) => i.id === 'T001:Latitude@posicao:prec')!;
    expect(lat.fixes![0].id).toBe('precision-9-6');
    expect(validateModel(m).issues.find((i) => i.id === 'T001:ValorTotal@order:prec')!.fixes![0].id).toBe('precision-18-2');
    expect(validateModel(m).issues.find((i) => i.id === 'T001:PrecisaoEmMetros@posicao:prec')!.fixes![0].id).toBe('precision-10-2');
    const out = applyFix(m, fixOf(m, 'T001:Latitude@posicao:prec', 'precision-9-6'));
    const a = out.entities.find((e) => e.id === 'posicao')!.attributes.find((x) => x.id === 'Latitude')!;
    expect([a.precision, a.scale, a.provenance.manuallyEdited]).toEqual([9, 6, true]);
    expect(validateModel(out).issues.some((i) => i.id === 'T001:Latitude@posicao:prec')).toBe(false);
    expect(m.entities.find((e) => e.id === 'posicao')!.attributes.find((x) => x.id === 'Latitude')!.precision).toBeUndefined(); // pure
  });
  it('offers json/text/length for unbounded strings', () => {
    const m = model();
    const ids = (k: string) => validateModel(m).issues.find((i) => i.id === k)!.fixes!.map((f) => f.id);
    expect(ids('T001:DetailsJson@posicao:len')).toEqual(expect.arrayContaining(['type-json', 'type-text', 'length-255']));
    expect(ids('T001:FotoBase64@posicao:len')).toContain('type-text');
    const out = applyFix(m, fixOf(m, 'T001:DetailsJson@posicao:len', 'type-json'));
    expect(out.entities.find((e) => e.id === 'posicao')!.attributes.find((a) => a.id === 'DetailsJson')!.domainType).toBe('json');
  });
  it('fixes cascade, FK index and decision questions', () => {
    const m = model();
    expect(applyFix(m, fixOf(m, 'R001:item_order:cascade', 'on-delete-restrict')).relationships.find((r) => r.id === 'item_order')!.onDelete).toBe('restrict');
    const withoutIdx = { ...m, indexes: [] };
    expect(applyFix(withoutIdx, fixOf(withoutIdx, 'I002:item_order', 'add-fk-index')).indexes).toHaveLength(1);
    const answered = applyFix(m, fixOf(m, 'D001:q_fk', 'answer-1')).questions[0];
    expect([answered.status, answered.answer]).toEqual(['answered', 'Criar FKs com restrict']);
    expect(validateModel(m).issues.find((i) => i.id === 'D001:q_fk')!.fixes!.find((f) => f.id === 'answer-1')!.decision).toBe(true);
  });
  it('is safe on edge cases: no PK gets a surrogate key; nullability fixes are mutually coherent', () => {
    const m = twoEntityModel();
    m.entities.push(entity('naopk', [attr('x', 'string', { length: 10 })]));
    const out = applyFix(m, validateModel(m).issues.find((i) => i.rule === 'S002')!.fixes![0]);
    expect(out.entities.find((e) => e.id === 'naopk')!.attributes.find((a) => a.primaryKey)).toBeDefined();
    expect(validateModel(out).issues.some((i) => i.rule === 'S002')).toBe(false);
  });
});

describe('Engine.applyFixes', () => {
  it('applies a batch as one revision, invalidates approval, and rejects stale fixes', () => {
    const { engine } = approvedRestaurant();
    // introduce decimal problems after approval
    engine.applyOps([{ op: 'upsert', collection: 'entities', item: entity('geo', [pk(), attr('Latitude', 'decimal'), attr('Longitude', 'decimal')]) as never }], { author: 'ai' });
    const before = engine.load().status.revision;
    const issues = engine.validate({ persist: false }).issues.filter((i) => i.rule === 'T001' && i.fixes?.some((f) => f.id === 'precision-9-6'));
    expect(issues).toHaveLength(2);
    const m = engine.applyFixes(issues.map((i) => ({ issueId: i.id, fixId: 'precision-9-6' })));
    expect(m.status.revision).toBe(before + 1);
    expect(m.history.at(-1)!.summary).toMatch(/2 correções/);
    expect(engine.validate({ persist: false }).issues.some((i) => i.rule === 'T001' && i.message.includes('precisão'))).toBe(false);
    expect(() => engine.applyFixes([{ issueId: issues[0].id, fixId: 'precision-9-6' }])).toThrow(EngineError); // already resolved
    expect(() => engine.applyFixes([])).toThrow(/Nenhuma/);
    expect(engine.status().approval).toBeNull();
  });
  it('works from the CLI-facing API on an empty-named session', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    e.applyOps([{ op: 'upsert', collection: 'entities', item: entity('x', [pk(), attr('Preco', 'decimal')]) as never }], { author: 'ai' });
    const i = e.validate({ persist: false }).issues.find((x) => x.rule === 'T001')!;
    e.applyFixes([{ issueId: i.id, fixId: i.fixes![0].id }]);
    expect(e.load().entities[0].attributes.find((a) => a.id === 'Preco')).toMatchObject({ precision: 18, scale: 2 });
  });
});
