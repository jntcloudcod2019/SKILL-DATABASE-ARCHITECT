import { describe, expect, it } from 'vitest';
import { scan } from '@dbarchitect/project-scanner';
import { dotnetAnalyzers } from '@dbarchitect/adapter-dotnet';
import { Engine } from '@dbarchitect/engine';
import { copyFixture } from './helpers.ts';
import { join } from 'node:path';
import { FIXTURES } from './helpers.ts';

const facts = () => scan(join(FIXTURES, 'dotnet-efcore-owned'), dotnetAnalyzers).facts;
const col = (table: string, name: string) => facts().tables.find((t) => t.name === table)!.columns.find((c) => c.name === name)!;

describe('EF Core owned types and JSON columns', () => {
  it('expands OwnsOne into the owner table with convention names, explicit names and optionality', () => {
    const names = facts().tables.find((t) => t.name === 'pedidos')!.columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Cliente_Nome', 'Cliente_Telefone', 'endereco_rua', 'Endereco_Numero', 'Endereco_Local_Latitude', 'Endereco_Local_Longitude']));
    expect(col('pedidos', 'Cliente_Nome')).toMatchObject({ nullable: false, length: 120 });
    // optional owned navigation (Endereco?) makes every one of its columns nullable, including nested ones
    expect(col('pedidos', 'Endereco_Local_Latitude').nullable).toBe(true);
    expect(col('pedidos', 'endereco_rua').nullable).toBe(true);
    expect(col('pedidos', 'Cliente_Nome').evidence.some((e) => /convenção/.test(e.note ?? ''))).toBe(true);
    expect(col('pedidos', 'endereco_rua').evidence.some((e) => /convenção/.test(e.note ?? ''))).toBe(false); // explicit HasColumnName
  });
  it('maps ToJson owned types and jsonb/JsonDocument properties to JSON columns, with the inner shape', () => {
    expect(col('pedidos', 'pagamento_json')).toMatchObject({ domainType: 'json', nullable: false });
    expect(col('pedidos', 'pagamento_json').description).toContain('Metodo:string');
    expect(facts().tables.find((t) => t.name === 'pedidos')!.columns.some((c) => c.name.startsWith('Pagamento_'))).toBe(false); // not split
    expect(col('pedidos', 'ReceiptData')).toMatchObject({ domainType: 'json', type: 'jsonb' });
    expect(col('pedidos', 'ReceiptData').description).toContain('Linhas[]{Descricao:string');
    expect(col('pedidos', 'Metadata')).toMatchObject({ domainType: 'json', nullable: true });
    expect(col('pedidos', 'Tags').domainType).toBe('json'); // [Column(TypeName = "jsonb")]
  });
  it('maps OwnsMany to its own table with owner FK (cascade) and conventional key', () => {
    const t = facts().tables.find((x) => x.name === 'pedido_itens')!;
    expect(t.columns.map((c) => c.name)).toEqual(['Id', 'PedidoId', 'Descricao', 'Quantidade', 'PrecoUnitario']);
    expect(t.columns[0]).toMatchObject({ primaryKey: true, generated: 'identity' });
    expect(t.columns.find((c) => c.name === 'PrecoUnitario')!.precision).toBe(18);
    expect(facts().relations).toContainEqual(expect.objectContaining({ fromTable: 'pedido_itens', fromColumns: ['PedidoId'], toTable: 'pedidos', toColumns: ['Id'], onDelete: 'cascade' }));
  });
  it('honours the [Owned] attribute without fluent configuration', () => {
    const names = facts().tables.find((t) => t.name === 'Merchants')!.columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['ConexaoIFood_MerchantExternalId', 'ConexaoIFood_Ativo', 'WhatsApp_Numero']));
    expect(col('Merchants', 'WhatsApp_Numero').nullable).toBe(true); // ConfigWhatsApp? is optional
  });
  it('no longer reports owned/JSON navigations as relations without a foreign key', () => {
    const f = facts();
    expect(f.unparsed).toEqual([]);
    expect(f.relations).toHaveLength(1);
    expect(f.limitations.join(' ')).toMatch(/owned\/complex\/JSON/);
  });
  it('flows into the canonical model with evidence and JSON shape', () => {
    const root = copyFixture('dotnet-efcore-owned');
    const e = new Engine(root);
    e.init({ mode: 'brownfield' });
    e.scan();
    const m = e.importScan();
    expect(m.entities.map((x) => x.table).sort()).toEqual(['Merchants', 'pedido_itens', 'pedidos']);
    expect(m.questions.filter((q) => /sem chave estrangeira/.test(q.text))).toEqual([]);
    const pedido = m.entities.find((x) => x.table === 'pedidos')!;
    const pag = pedido.attributes.find((a) => a.column === 'pagamento_json')!;
    expect(pag.domainType).toBe('json');
    expect(pag.description).toContain('ValorPago:decimal');
    expect(pag.provenance.origin).toBe('code');
    expect(m.relationships).toHaveLength(1);
    // doubles became decimals without precision: the validator still flags them, and offers a fix
    const lat = e.validate({ persist: false }).issues.find((i) => i.id.includes('endereco_local_latitude'));
    expect(lat?.fixes?.[0].id).toBe('precision-9-6');
  });
});

describe('re-import after scanner improvements', () => {
  it('rebuilds code-derived elements, keeps user/AI additions and answered questions, refuses dangling references', () => {
    const root = copyFixture('dotnet-efcore-owned');
    const e = new Engine(root);
    e.init({ mode: 'brownfield' });
    e.scan();
    e.importScan();
    expect(() => e.importScan()).toThrow(/reimportação/);
    // user adds an answered decision and an AI entity unrelated to code entities
    e.applyOps([
      { op: 'upsert', collection: 'questions', item: { id: 'q_dec', text: 'Manter sem FK?', impact: 'high', status: 'answered', answer: 'sim', provenance: { origin: 'user' } } },
      { op: 'upsert', collection: 'entities', item: { id: 'coupon', name: 'Coupon', kind: 'entity', persistence: 'persistent', uniqueConstraints: [], checks: [], attributes: [{ id: 'id', name: 'Id', domainType: 'uuid', nullable: false, domainOptional: false, primaryKey: true, provenance: { origin: 'ai' } }], provenance: { origin: 'ai', rationale: 'novo' } } },
    ], { author: 'ai' });
    e.scan();
    const m = e.importScan({ replace: true });
    expect(m.entities.map((x) => x.id)).toContain('coupon');
    expect(m.entities.filter((x) => x.provenance.origin === 'code')).toHaveLength(3);
    expect(m.questions.some((q) => q.id === 'q_dec' && q.answer === 'sim')).toBe(true);
    // an AI relationship pointing at a code entity blocks the re-import instead of dangling
    e.applyOps([{ op: 'upsert', collection: 'relationships', item: { id: 'rel_ai', from: { entity: 'coupon', attributes: [] }, to: { entity: 'pedido', attributes: ['id'] }, cardinality: 'N:1', required: false, onDelete: 'restrict', provenance: { origin: 'ai' } } }], { author: 'ai' });
    expect(() => e.importScan({ replace: true })).toThrow(/Remova ou reaponte/);
  });
});
