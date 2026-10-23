import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, EngineError } from '@dbarchitect/engine';
import { Store } from '@dbarchitect/core/node';
import { attr, approvedRestaurant, copyFixture, entity, pk, restaurantOps, snapshotProject, tempDir, FIXTURES } from './helpers.ts';

describe('greenfield: empty folder (G1, G13)', () => {
  it('starts a session in an empty folder without inventing entities, ORM or database', () => {
    const root = tempDir();
    const e = new Engine(root);
    const m = e.init({ mode: 'greenfield', name: 'Novo' });
    expect(m.status.state).toBe('DISCOVERING');
    expect(m.entities).toHaveLength(0);
    expect(m.project.orm).toBeUndefined();
    expect(m.project.profile).toEqual({ confirmed: false });
    expect(readdirSync(root)).toEqual(['.database-architect']);
  });
  it('does not need language/ORM files to model (G13)', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield', name: 'X' });
    e.applyOps(restaurantOps(), { author: 'ai' });
    expect(e.load().project.languages).toEqual([]);
    expect(e.validate().blocking).toBe(0);
  });
  it('refuses to init twice', () => {
    const root = tempDir();
    new Engine(root).init({ mode: 'greenfield' });
    expect(() => new Engine(root).init({ mode: 'greenfield' })).toThrow(/Já existe/);
  });
});

describe('greenfield: description only (G2) and pending decisions (G5)', () => {
  it('keeps the description, records unanswered questions and hypotheses without inventing answers', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield', description: 'Quero um sistema de pedidos para restaurantes com iFood e 99Food' });
    e.applyOps([
      { op: 'upsert', collection: 'domain.actors', item: { id: 'actor_attendant', name: 'Atendente', provenance: { origin: 'user' } } },
      { op: 'upsert', collection: 'domain.concepts', item: { id: 'c_order', name: 'Pedido', kind: 'entity', provenance: { origin: 'user' } } },
      { op: 'upsert', collection: 'domain.concepts', item: { id: 'c_external_order', name: 'Pedido externo', kind: 'external', provenance: { origin: 'ai', rationale: 'Pode ser representação do pedido interno' } } },
      { op: 'upsert', collection: 'questions', item: { id: 'q_ext_order', text: 'Pedido externo é entidade separada ou representação do pedido interno?', impact: 'critical', status: 'open', options: ['separada', 'mesma entidade'], consequences: 'Muda a chave natural e a idempotência.', relatedTo: ['c_external_order'], provenance: { origin: 'ai' } } },
      { op: 'upsert', collection: 'hypotheses', item: { id: 'h1', statement: 'Pedido não é editável após DISPATCHED', status: 'unconfirmed', consequences: 'Sem versionamento de itens', provenance: { origin: 'ai' } } },
    ], { author: 'ai' });
    const m = e.load();
    expect(m.domain.problem).toContain('iFood');
    expect(m.status.state).toBe('NEEDS_INPUT');
    expect(m.entities).toHaveLength(0);
    const r = e.validate();
    expect(r.blocking).toBe(1);
    expect(r.issues.map((i) => i.id)).toContain('D001:q_ext_order');
    expect(e.load().status.state).toBe('NEEDS_INPUT');
  });
});

describe('approval (scenarios 4, 5)', () => {
  it('blocks approval of an invalid model', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    e.applyOps(restaurantOps(), { author: 'ai' });
    e.applyOps([{ op: 'remove', collection: 'relationships', id: 'order_restaurant' }, { op: 'upsert', collection: 'relationships', item: { id: 'bad', from: { entity: 'order', attributes: ['restaurant_id'] }, to: { entity: 'nowhere', attributes: [] }, cardinality: 'N:1', required: true, onDelete: 'restrict', provenance: { origin: 'ai' } } }], { author: 'ai' });
    expect(() => e.approve('Maria')).toThrowError(/bloqueada/);
    expect(e.status().approval).toBeNull();
  });
  it('requires a named approver and READY_FOR_REVIEW', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    e.applyOps(restaurantOps(), { author: 'ai' });
    expect(() => e.approve('  ')).toThrow(/quem/);
  });
  it('approval is bound to the exact hash and is invalidated by any change', () => {
    const { engine } = approvedRestaurant();
    const before = engine.status();
    expect(before.state).toBe('APPROVED');
    expect(before.approval?.approvedBy).toBe('Maria');
    engine.applyOps([{ op: 'upsert', collection: 'entities', item: entity('note', [pk(), attr('text', 'text')]) as never }], { author: 'manual' });
    const after = engine.status();
    expect(after.approval).toBeNull();
    expect(after.state).not.toBe('APPROVED');
    expect(engine.load().approvals.at(-1)?.invalidatedAt).toBeDefined();
    expect(() => engine.generate('sql')).toThrow(/aprovação válida/);
  });
  it('re-approval requires fresh validation of the new version', () => {
    const { engine } = approvedRestaurant();
    engine.applyOps([{ op: 'upsert', collection: 'entities', item: entity('note', [pk(), attr('text', 'text')]) as never }], { author: 'manual' });
    expect(() => engine.approve('Maria')).not.toThrow(); // approve() validates itself
    expect(engine.status().approval?.revision).toBe(engine.load().status.revision);
  });
  it('rejects stale edits (optimistic concurrency)', () => {
    const { engine } = approvedRestaurant();
    expect(() => engine.applyOps([], { author: 'manual', expectedRevision: 0 })).toThrow(EngineError);
  });
  it('AI cannot claim code origin without file evidence; manual edits are flagged', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    const fake = entity('x', [pk()], { provenance: { origin: 'code' } });
    expect(() => e.applyOps([{ op: 'upsert', collection: 'entities', item: fake as never }], { author: 'ai' })).toThrow(/evidência/);
    const ok = entity('x', [pk()]);
    e.applyOps([{ op: 'upsert', collection: 'entities', item: ok as never }], { author: 'ai' });
    const edited = structuredClone(ok);
    edited.name = 'Renamed';
    e.applyOps([{ op: 'upsert', collection: 'entities', item: edited as never }], { author: 'manual' });
    expect(e.load().entities[0].provenance.manuallyEdited).toBe(true);
  });
  it('schema-invalid ops are rejected and nothing is persisted', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    expect(() => e.applyOps([{ op: 'upsert', collection: 'entities', item: { id: 'bad' } }], { author: 'ai' })).toThrow(/schema/i);
    expect(e.load().entities).toHaveLength(0);
  });
});

describe('persistence and resume (scenarios 7, G11, G8)', () => {
  it('persists and recovers models, versions, answers and approvals in a new Engine instance', () => {
    const { engine, root } = approvedRestaurant();
    engine.applyOps([{ op: 'upsert', collection: 'questions', item: { id: 'q9', text: 'Quanto tempo reter dados?', impact: 'low', status: 'answered', answer: '5 anos', provenance: { origin: 'user' } } }], { author: 'manual' });
    engine.validate();
    engine.approve('Maria', 'v2');
    const again = new Engine(root);
    const m = again.load();
    expect(m.questions.find((q) => q.id === 'q9')?.answer).toBe('5 anos');
    expect(again.status().approval?.approvedBy).toBe('Maria');
    expect(again.store.listVersions().length).toBeGreaterThanOrEqual(2);
    expect(new Store(root).loadVersion(1).entities.length).toBeGreaterThan(0);
    expect(m.history.length).toBeGreaterThan(2);
  });
  it('interrupted session resumes in NEEDS_INPUT with answers kept (G11)', () => {
    const root = tempDir();
    const e = new Engine(root);
    e.init({ mode: 'greenfield', description: 'sistema' });
    e.applyOps([{ op: 'upsert', collection: 'questions', item: { id: 'q', text: '?', impact: 'critical', status: 'open', provenance: { origin: 'ai' } } }], { author: 'ai' });
    const resumed = new Engine(root);
    expect(resumed.status().state).toBe('NEEDS_INPUT');
    resumed.applyOps([{ op: 'upsert', collection: 'questions', item: { id: 'q', text: '?', impact: 'critical', status: 'answered', answer: 'sim', provenance: { origin: 'user' } } }], { author: 'manual' });
    expect(new Engine(root).status().state).toBe('DRAFT');
  });
  it('domain approval is bound to the domain hash (G8)', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    e.applyOps([{ op: 'upsert', collection: 'domain.concepts', item: { id: 'c', name: 'Pedido', kind: 'entity', provenance: { origin: 'user' } } }], { author: 'user' });
    e.approveDomain('Maria');
    expect(e.status().domainApproved).toBe(true);
    e.applyOps([{ op: 'upsert', collection: 'domain.concepts', item: { id: 'c2', name: 'Item', kind: 'entity', provenance: { origin: 'user' } } }], { author: 'user' });
    expect(e.status().domainApproved).toBe(false);
  });
});

describe('generation (scenarios 12-14, G10, G12)', () => {
  it('generates SQL for an approved model into staging only, and verifies it by executing it', () => {
    const { engine, root } = approvedRestaurant();
    const before = snapshotProject(root);
    const man = engine.generate('sql');
    expect(man.dialect).toBe('sqlite');
    expect(man.verification[0]).toMatchObject({ name: 'sqlite-ddl', status: 'passed' });
    expect(snapshotProject(root)).toEqual(before); // (13) nothing changed in the project
    expect(existsSync(join(root, '.database-architect/generated/sql-sqlite/r0002/database/schema.sqlite.sql'))).toBe(true);
    expect(engine.status().state).toBe('GENERATED');
    expect(man.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('refuses generation without approval or with an unconfirmed profile', () => {
    const e = new Engine(tempDir());
    e.init({ mode: 'greenfield' });
    e.applyOps(restaurantOps(), { author: 'ai' });
    expect(() => e.generate('sql', { dialect: 'sqlite' })).toThrow(/aprovação válida/);
    e.validate();
    e.approve('Maria');
    expect(() => e.generate('sql')).toThrow(/perfil tecnológico/);
    expect(() => e.generate('nope', { dialect: 'sqlite' })).toThrow(/desconhecido/);
  });
  it('apply needs explicit authorization separate from approval; existing files need overwrite; migrations never overwritten (13, 14)', () => {
    const { engine, root } = approvedRestaurant();
    engine.generate('sql');
    const before = snapshotProject(root);
    expect(() => engine.apply('sql', 'sqlite', { authorize: false })).toThrow(/autorização explícita/);
    expect(snapshotProject(root)).toEqual(before);
    // existing file with different content
    mkdirSync(join(root, 'database'), { recursive: true });
    writeFileSync(join(root, 'database/schema.sqlite.sql'), '-- mine\n');
    const plan = engine.planApply('sql', 'sqlite');
    expect(plan[0].status).toBe('modified');
    expect(plan[0].diff).toContain('-- mine');
    let man = engine.apply('sql', 'sqlite', { authorize: true });
    expect(man.applied!.written).toEqual([]);
    expect(readFileSync(join(root, 'database/schema.sqlite.sql'), 'utf8')).toBe('-- mine\n');
    man = engine.apply('sql', 'sqlite', { authorize: true, overwrite: true });
    expect(man.applied!.written).toEqual(['database/schema.sqlite.sql']);
    expect(readFileSync(join(root, 'database/schema.sqlite.sql'), 'utf8')).toContain('CREATE TABLE');
  });
  it('never overwrites existing migrations even with overwrite', () => {
    const { engine, root } = approvedRestaurant();
    engine.generate('sql');
    // the staged file lands at <outDir>/database/schema.sqlite.sql, so the pre-existing migration sits there
    mkdirSync(join(root, 'db/migrations/database'), { recursive: true });
    writeFileSync(join(root, 'db/migrations/database/schema.sqlite.sql'), '-- history\n');
    const plan = engine.planApply('sql', 'sqlite', 'db/migrations');
    expect(plan[0].status).toBe('blocked');
    const man = engine.apply('sql', 'sqlite', { authorize: true, overwrite: true, outDir: 'db/migrations' });
    expect(man.applied!.skipped[0].reason).toMatch(/migrations/);
    expect(readFileSync(join(root, 'db/migrations/database/schema.sqlite.sql'), 'utf8')).toBe('-- history\n');
  });
  it('blocks writes outside the authorized root', () => {
    const { engine } = approvedRestaurant();
    engine.generate('sql');
    expect(engine.planApply('sql', 'sqlite', '../escape')[0].status).toBe('blocked');
  });
  it('stale artifacts cannot be applied after the model changes', () => {
    const { engine } = approvedRestaurant();
    engine.generate('sql');
    engine.applyOps([{ op: 'upsert', collection: 'entities', item: entity('note', [pk()]) as never }], { author: 'manual' });
    expect(() => engine.planApply('sql', 'sqlite')).toThrow(/anterior/);
  });
  it('starting a project executes no migration and creates no database (G12)', () => {
    const root = tempDir();
    const e = new Engine(root);
    e.init({ mode: 'greenfield' });
    e.applyOps(restaurantOps(), { author: 'ai' });
    const files = JSON.stringify(readdirSync(root, { recursive: true }));
    expect(files).not.toMatch(/\.(db|sqlite|sqlite3)\b/);
    expect(files).not.toMatch(/migration/i);
  });
});

describe('three modes share the model and validators (G14)', () => {
  it('uses the same model shape and rule set in every mode', () => {
    const models = (['greenfield', 'brownfield', 'evolution'] as const).map((mode) => {
      const e = new Engine(tempDir());
      e.init({ mode });
      e.applyOps(restaurantOps(), { author: 'ai' });
      return { mode, m: e.load(), r: e.validate() };
    });
    expect(new Set(models.map((x) => x.m.formatVersion)).size).toBe(1);
    expect(new Set(models.map((x) => x.m.project.mode)).size).toBe(3);
    expect(new Set(models.map((x) => JSON.stringify(x.r.issues.map((i) => i.id)))).size).toBe(1);
  });
});

describe('documents and contracts (G3, G4)', () => {
  it('imports requirements without source code and contracts without creating tables', () => {
    const root = tempDir();
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/req.md'), readFileSync(join(FIXTURES, 'requirements/restaurant-orders.md')));
    writeFileSync(join(root, 'docs/api.yaml'), readFileSync(join(FIXTURES, 'external-api/delivery-platform.openapi.yaml')));
    writeFileSync(join(root, '.env'), 'SECRET=1');
    const e = new Engine(root);
    e.init({ mode: 'greenfield' });
    const r = e.importDocuments(['docs/req.md', 'docs/api.yaml', '.env', '../outside.md', 'nope.md']);
    expect(r.imported).toEqual(['docs/req.md', 'docs/api.yaml']);
    expect(r.contracts).toBe(3);
    expect(r.skipped.map((s) => s.path)).toEqual(['.env', '../outside.md', 'nope.md']);
    const m = e.load();
    expect(m.entities).toHaveLength(0);
    expect(m.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['document', 'openapi']));
    const view = m.contracts.find((c) => c.name === 'OrderView')!;
    expect(view.usage).toEqual(['response']);
    // mapping decisions stay explicit: unmapped fields are reported, not silently turned into columns
    const issues = e.validate().issues;
    expect(issues.some((i) => i.rule === 'C001' && i.message.includes('sem tratamento'))).toBe(true);
  });
});

describe('visual-style edit flow via saveEdited (G6, 11)', () => {
  it('creates, renames and edits entities/attributes and persists them', () => {
    const { engine } = approvedRestaurant();
    const m = engine.load();
    const edited = structuredClone(m);
    edited.entities.find((x) => x.id === 'courier')!.name = 'Rider';
    edited.entities.find((x) => x.id === 'courier')!.attributes.find((a) => a.id === 'name')!.length = 80;
    edited.entities.push(entity('vehicle', [pk(), attr('plate', 'string', { length: 8, unique: true })]));
    const saved = engine.saveEdited(edited, m.status.revision);
    expect(saved.status.revision).toBe(m.status.revision + 1);
    const reloaded = new Engine(engine.root).load();
    expect(reloaded.entities.find((x) => x.id === 'courier')!.name).toBe('Rider');
    expect(reloaded.entities.find((x) => x.id === 'vehicle')).toBeDefined();
    expect(reloaded.entities.find((x) => x.id === 'courier')!.provenance.manuallyEdited).toBe(true);
  });
});

describe('brownfield / evolution from scan', () => {
  it('imports EF Core facts with evidence, keeps secrets out, and flags what it could not read', () => {
    const root = copyFixture('dotnet-efcore');
    const e = new Engine(root);
    e.init({ mode: 'brownfield' });
    const before = snapshotProject(root);
    const s = e.scan();
    expect(s.coverage.skipped.secretFiles).toContain('.env');
    expect(JSON.stringify(s)).not.toContain('SuperSecret123');
    expect(JSON.stringify(s)).not.toContain('topsecret');
    const m = e.importScan();
    expect(m.entities.map((x) => x.table).sort()).toEqual(['customers', 'order_items', 'orders']);
    expect(m.relationships).toHaveLength(2);
    const order = m.entities.find((x) => x.table === 'orders')!;
    expect(order.provenance.origin).toBe('code');
    expect(order.provenance.evidence?.[0].file).toMatch(/ShopContext\.cs$/);
    expect(m.enums.find((x) => x.name === 'OrderStatus')?.values).toContain('Dispatched');
    expect(m.project.orm).toMatch(/Entity Framework Core/);
    expect(snapshotProject(root)).toEqual(before);
    expect(() => e.importScan()).toThrow(/já foram importados/);
  });
  it('evolution: baseline is kept so only new changes appear in the diff', () => {
    const root = copyFixture('node-prisma');
    const e = new Engine(root);
    e.init({ mode: 'evolution' });
    e.scan();
    e.importScan();
    expect(e.diff()).toEqual([]);
    e.applyOps([{ op: 'upsert', collection: 'entities', item: entity('coupon', [pk(), attr('code', 'string', { length: 20 })]) as never }], { author: 'ai' });
    const d = e.diff();
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'added', element: 'entity', risk: 'safe' });
  });
});
