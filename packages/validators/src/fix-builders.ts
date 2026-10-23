import type { Attribute, CanonicalModel, Entity, Fix, FixAction } from '@dbarchitect/core';

export const setAttr = (entity: string, attribute: string, set: Partial<Attribute>, unset?: Array<keyof Attribute>): FixAction => ({ type: 'setAttribute', entity, attribute, set, ...(unset ? { unset } : {}) });

const COORD = /(^|_|[a-z])(lat|lng|lon)(itude|gitude)?($|[A-Z_])/i;
const MONEY = /(preco|price|valor|total|taxa|fee|amount|custo|cost|saldo|balance|desconto|discount|tarifa|salario|pagamento|payment)/i;
const MEASURE = /(precisao|accuracy|metros|meters|distancia|distance|km|peso|weight|altura|height|quantidade|qty)/i;

/** Options for a decimal without precision. The first one is a suggestion inferred from the field NAME only — the user chooses. */
export function precisionFixes(e: Entity, a: Attribute): Fix[] {
  const opt = (p: number, s: number, label: string, hint?: string): Fix => ({
    id: `precision-${p}-${s}`,
    label: `${label}: precisão ${p}, escala ${s}`,
    description: `${e.name}.${a.name}: precision=${p}, scale=${s}.${hint ? ' ' + hint : ''}`,
    actions: [setAttr(e.id, a.id, { precision: p, scale: s })],
  });
  const all = {
    coord: opt(9, 6, 'Coordenada geográfica', 'Escala 6 ≈ 0,1 m de resolução; cobre ±999,999999.'),
    money: opt(18, 2, 'Valor monetário', 'Centavos; cobre até 10^16.'),
    measure: opt(10, 2, 'Medida (metros, km, peso…)', 'Duas casas decimais.'),
    gen4: opt(18, 4, 'Genérico, 4 casas'),
  };
  const first = COORD.test(a.name) ? 'coord' : a.domainType === 'money' || MONEY.test(a.name) ? 'money' : MEASURE.test(a.name) ? 'measure' : 'money';
  const order = [first, ...(['money', 'coord', 'measure', 'gen4'] as const).filter((k) => k !== first)] as const;
  return order.map((k) => all[k]);
}

const JSONISH = /(json|payload|raw|details|config|settings|metadata|opening|status)/i;
const BLOB = /(base64|html|xml|content|conteudo|body|texto|text|description|descricao|notes|observac)/i;

export function lengthFixes(e: Entity, a: Attribute): Fix[] {
  const out: Fix[] = [];
  const asType = (id: string, label: string, t: Attribute['domainType'], why: string): Fix => ({
    id, label, description: `${e.name}.${a.name}: domainType ${a.domainType} → ${t}. ${why}`, actions: [setAttr(e.id, a.id, { domainType: t }, ['length'])],
  });
  const len = (n: number, why?: string): Fix => ({
    id: `length-${n}`, label: `Limitar a ${n} caracteres`, description: `${e.name}.${a.name}: length=${n}.${why ? ' ' + why : ''}`, actions: [setAttr(e.id, a.id, { length: n })],
  });
  if (JSONISH.test(a.name)) out.push(asType('type-json', 'Tipo JSON (jsonb / JSON)', 'json', 'Valida o formato no banco e permite consultar campos internos.'));
  if (BLOB.test(a.name) || JSONISH.test(a.name)) out.push(asType('type-text', 'Texto livre (text)', 'text', 'Sem limite; adequado para conteúdo grande.'));
  out.push(len(255, 'Valor padrão comum para textos curtos.'), len(1000));
  if (!out.some((f) => f.id === 'type-text')) out.push(asType('type-text', 'Texto livre (text)', 'text', 'Sem limite.'));
  return out;
}

/** Surrogate key proposal for an entity without PK; follows conventions.primaryKeyStrategy (uuid when undecided). */
export function surrogateKeyFix(m: CanonicalModel, e: Entity): Fix | undefined {
  if (e.attributes.some((a) => a.id === 'id')) return undefined;
  const strategy = m.conventions.primaryKeyStrategy;
  const identity = strategy === 'identity';
  const attribute: Attribute = {
    id: 'id', name: 'Id', domainType: identity ? 'bigint' : 'uuid', nullable: false, domainOptional: false, primaryKey: true, generated: identity ? 'identity' : 'uuid',
    provenance: { origin: 'manual', rationale: `Chave substituta adicionada pela correção sugerida (estratégia: ${strategy === 'undecided' ? 'uuid por padrão' : strategy}).` },
  };
  return { id: 'add-surrogate-key', label: `Adicionar chave substituta ${identity ? 'identity' : 'UUID'}`, description: `Cria ${e.name}.Id como chave primária (${identity ? 'bigint identity' : 'uuid gerado'}).`, decision: true, actions: [{ type: 'addAttribute', entity: e.id, attribute }] };
}
