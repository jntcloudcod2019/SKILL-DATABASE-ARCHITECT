import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Attribute, CanonicalModel, DomainType, Entity, Op, Provenance, Relationship } from '@dbarchitect/core';
import { createEmptyModel } from '@dbarchitect/core';
import { Engine } from '@dbarchitect/engine';

export const FIXTURES = join(import.meta.dirname, '../fixtures');
export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'dba-'));

export function copyFixture(name: string): string {
  const d = tempDir();
  cpSync(join(FIXTURES, name), d, { recursive: true });
  return d;
}

/** path -> file content hash for every file outside the tool's metadata folder. */
export function snapshotProject(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === '.database-architect') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

const ai: Provenance = { origin: 'ai', rationale: 'test', confidence: 'medium' };

export function attr(id: string, domainType: DomainType, extra: Partial<Attribute> = {}): Attribute {
  return { id, name: id, domainType, nullable: false, domainOptional: false, provenance: ai, ...extra };
}

export function entity(id: string, attributes: Attribute[], extra: Partial<Entity> = {}): Entity {
  return { id, name: id[0].toUpperCase() + id.slice(1), kind: 'entity', persistence: 'persistent', attributes, uniqueConstraints: [], checks: [], provenance: ai, ...extra };
}

export function pk(id = 'id'): Attribute {
  return attr(id, 'uuid', { primaryKey: true, generated: 'uuid' });
}

export function rel(id: string, from: string, fk: string, to: string, extra: Partial<Relationship> = {}): Relationship {
  return { id, from: { entity: from, attributes: [fk] }, to: { entity: to, attributes: ['id'] }, cardinality: 'N:1', required: true, onDelete: 'restrict', provenance: ai, ...extra };
}

/** Two related, valid entities. */
export function twoEntityModel(): CanonicalModel {
  const m = createEmptyModel({ name: 'Shop', mode: 'greenfield', rootDir: '.' });
  m.entities.push(
    entity('customer', [pk(), attr('name', 'string', { length: 120 })]),
    entity('order', [pk(), attr('customer_id', 'uuid'), attr('total', 'money', { precision: 18, scale: 2 })]),
  );
  m.relationships.push(rel('order_customer', 'order', 'customer_id', 'customer'));
  m.indexes.push({ id: 'ix_order_customer', entity: 'order', attributes: ['customer_id'], unique: false, provenance: ai });
  return m;
}

/** Realistic greenfield model derived from the restaurant-orders scenario. No blocking issues. */
export function restaurantOps(): Op[] {
  const u = (id: string, name: string, t: DomainType, extra: Partial<Attribute> = {}) => attr(id, t, { name, ...extra });
  const entities: Entity[] = [
    entity('restaurant', [pk(), u('name', 'Name', 'string', { length: 120 })], { name: 'Restaurant', table: 'restaurants' }),
    entity('order', [
      pk(), u('restaurant_id', 'RestaurantId', 'uuid'), u('channel', 'Channel', 'enum', { enumRef: 'enum_channel' }),
      u('external_id', 'ExternalId', 'string', { length: 64, nullable: true, domainOptional: true, sourceOfTruth: 'external:marketplace' }),
      u('status', 'Status', 'enum', { enumRef: 'enum_order_status', default: { kind: 'literal', value: 'RECEIVED' } }),
      u('total', 'Total', 'money', { precision: 18, scale: 2 }),
      u('created_at', 'CreatedAt', 'datetime', { generated: 'now' }),
      u('delivered_at', 'DeliveredAt', 'datetime', { nullable: true, domainOptional: true, requiredWhen: [{ condition: "status = 'DELIVERED'" }] }),
    ], { name: 'Order', table: 'orders', uniqueConstraints: [{ id: 'uq_order_external', attributes: ['restaurant_id', 'channel', 'external_id'] }] }),
    entity('order_item', [pk(), u('order_id', 'OrderId', 'uuid'), u('description', 'Description', 'string', { length: 200 }), u('quantity', 'Quantity', 'integer'), u('unit_price', 'UnitPrice', 'money', { precision: 18, scale: 2 })], { name: 'OrderItem', table: 'order_items' }),
    entity('payment', [pk(), u('order_id', 'OrderId', 'uuid'), u('amount', 'Amount', 'money', { precision: 18, scale: 2 }), u('status', 'Status', 'string', { length: 20 })], { name: 'Payment', table: 'payments' }),
    entity('courier', [pk(), u('restaurant_id', 'RestaurantId', 'uuid'), u('name', 'Name', 'string', { length: 120 })], { name: 'Courier', table: 'couriers' }),
    entity('delivery', [pk(), u('order_id', 'OrderId', 'uuid'), u('courier_id', 'CourierId', 'uuid', { nullable: true, domainOptional: true }), u('fee', 'Fee', 'money', { precision: 18, scale: 2 })], { name: 'Delivery', table: 'deliveries' }),
  ];
  const rels = [
    rel('order_restaurant', 'order', 'restaurant_id', 'restaurant'),
    rel('item_order', 'order_item', 'order_id', 'order', { onDelete: 'cascade', identifying: true }),
    rel('payment_order', 'payment', 'order_id', 'order'),
    rel('courier_restaurant', 'courier', 'restaurant_id', 'restaurant'),
    rel('delivery_order', 'delivery', 'order_id', 'order'),
    rel('delivery_courier', 'delivery', 'courier_id', 'courier', { required: false, onDelete: 'set-null' }),
  ];
  const ix = (id: string, entity: string, attributes: string[]) => ({ op: 'upsert' as const, collection: 'indexes' as const, item: { id, entity, attributes, unique: false, provenance: ai } });
  return [
    ...entities.map((item) => ({ op: 'upsert' as const, collection: 'entities' as const, item: item as never })),
    ...rels.map((item) => ({ op: 'upsert' as const, collection: 'relationships' as const, item: item as never })),
    { op: 'upsert', collection: 'enums', item: { id: 'enum_channel', name: 'Channel', values: ['IFOOD', 'NINETY_NINE_FOOD', 'OWN'], provenance: ai } },
    { op: 'upsert', collection: 'enums', item: { id: 'enum_order_status', name: 'OrderStatus', values: ['RECEIVED', 'PREPARING', 'DISPATCHED', 'DELIVERED', 'CANCELLED'], provenance: ai } },
    ix('ix_order_restaurant', 'order', ['restaurant_id', 'status']),
    ix('ix_item_order', 'order_item', ['order_id']),
    ix('ix_payment_order', 'payment', ['order_id']),
    ix('ix_courier_restaurant', 'courier', ['restaurant_id']),
    ix('ix_delivery_order', 'delivery', ['order_id']),
    ix('ix_delivery_courier', 'delivery', ['courier_id']),
    { op: 'set', path: 'conventions', value: { naming: 'snake_case', primaryKeyStrategy: 'uuid', tenancy: { strategy: 'none' } } },
  ];
}

export function approvedRestaurant(root = tempDir()): { engine: Engine; root: string } {
  const engine = new Engine(root);
  engine.init({ mode: 'greenfield', name: 'Restaurant Orders', description: 'Sistema de gestão de pedidos para restaurantes' });
  engine.applyOps(restaurantOps(), { author: 'ai' });
  engine.applyOps([{ op: 'set', path: 'project.profile', value: { database: 'sqlite', persistence: 'sql', confirmed: true } }], { author: 'manual' });
  engine.validate();
  engine.approve('Maria');
  return { engine, root };
}

export { mkdirSync };
