import type { CanonicalModel, Entity, Fix, FixAction } from '@dbarchitect/core';

export class FixError extends Error {}

function touch(provenance: { manuallyEdited?: boolean }): void {
  provenance.manuallyEdited = true;
}

/** Applies one action to a copy of the model. Pure; throws FixError when the target no longer exists. */
export function applyFixAction(model: CanonicalModel, a: FixAction): CanonicalModel {
  const m = structuredClone(model);
  const entity = (id: string): Entity => {
    const e = m.entities.find((x) => x.id === id);
    if (!e) throw new FixError(`Entidade não encontrada: ${id}`);
    return e;
  };
  switch (a.type) {
    case 'setAttribute': {
      const attr = entity(a.entity).attributes.find((x) => x.id === a.attribute);
      if (!attr) throw new FixError(`Atributo não encontrado: ${a.entity}.${a.attribute}`);
      Object.assign(attr, a.set);
      for (const k of a.unset ?? []) delete attr[k];
      touch(attr.provenance);
      break;
    }
    case 'addAttribute': {
      const e = entity(a.entity);
      if (e.attributes.some((x) => x.id === a.attribute.id)) throw new FixError(`Atributo já existe: ${a.entity}.${a.attribute.id}`);
      e.attributes.push(structuredClone(a.attribute));
      break;
    }
    case 'setRelationship': {
      const r = m.relationships.find((x) => x.id === a.relationship);
      if (!r) throw new FixError(`Relacionamento não encontrado: ${a.relationship}`);
      Object.assign(r, a.set);
      touch(r.provenance);
      break;
    }
    case 'addIndex':
      if (!m.indexes.some((x) => x.id === a.index.id)) m.indexes.push(structuredClone(a.index));
      break;
    case 'removeIndex':
      if (!m.indexes.some((x) => x.id === a.id)) throw new FixError(`Índice não encontrado: ${a.id}`);
      m.indexes = m.indexes.filter((x) => x.id !== a.id);
      break;
    case 'setItem': {
      const list = (m[a.collection] as Array<{ id: string; provenance: { manuallyEdited?: boolean } }>);
      const item = list.find((x) => x.id === a.id);
      if (!item) throw new FixError(`${a.collection}: item não encontrado ${a.id}`);
      Object.assign(item, a.set);
      break;
    }
  }
  return m;
}

export function applyFix(model: CanonicalModel, fix: Fix): CanonicalModel {
  return fix.actions.reduce(applyFixAction, model);
}
