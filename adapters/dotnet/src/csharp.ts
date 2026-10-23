import { applyNaming, type Attribute, type CanonicalModel, type Entity } from '@dbarchitect/core';

export const pascal = (s: string) => applyNaming(s, 'PascalCase');
export const camel = (s: string) => applyNaming(s, 'camelCase');

const KEYWORDS = new Set(['abstract','as','base','bool','break','byte','case','catch','char','checked','class','const','continue','decimal','default','delegate','do','double','else','enum','event','explicit','extern','false','finally','fixed','float','for','foreach','goto','if','implicit','in','int','interface','internal','is','lock','long','namespace','new','null','object','operator','out','override','params','private','protected','public','readonly','ref','return','sbyte','sealed','short','sizeof','stackalloc','static','string','struct','switch','this','throw','true','try','typeof','uint','ulong','unchecked','unsafe','ushort','using','virtual','void','volatile','while']);

export function csIdent(s: string): string {
  const id = s.replace(/^[^A-Za-z_]+/, '_');
  return KEYWORDS.has(id) ? `@${id}` : id;
}

export function plural(s: string): string {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}

export function className(e: Entity): string {
  return csIdent(pascal(e.name));
}

export function propName(a: Attribute): string {
  return csIdent(pascal(a.name));
}

/** C# type for an attribute; enumTypes maps enum id -> generated C# enum name. */
export function csType(a: Attribute, model: CanonicalModel, enumTypes: Map<string, string>): string {
  let t: string;
  switch (a.domainType) {
    case 'string': case 'text': case 'json': t = 'string'; break;
    case 'enum': t = (a.enumRef && enumTypes.get(a.enumRef)) || 'string'; break;
    case 'integer': t = 'int'; break;
    case 'bigint': t = 'long'; break;
    case 'decimal': case 'money': t = 'decimal'; break;
    case 'boolean': t = 'bool'; break;
    case 'date': t = 'DateOnly'; break;
    case 'datetime': t = 'DateTimeOffset'; break;
    case 'time': t = 'TimeOnly'; break;
    case 'uuid': t = 'Guid'; break;
    case 'binary': t = 'byte[]'; break;
  }
  void model;
  return a.nullable && !a.primaryKey ? `${t}?` : t;
}

export function isValueType(t: string): boolean {
  return !['string', 'string?', 'byte[]', 'byte[]?'].includes(t);
}

export function namespaceFor(model: CanonicalModel, options: Record<string, unknown>): string {
  const ns = options.namespace;
  return typeof ns === 'string' && ns ? ns : csIdent(pascal(model.project.name)) || 'App';
}

export function enumTypeMap(model: CanonicalModel): Map<string, string> {
  return new Map(model.enums.map((e) => [e.id, csIdent(pascal(e.name))]));
}

export function enumMember(v: string): string {
  const id = pascal(v);
  return /^[A-Za-z_]/.test(id) ? id : `V${id}`;
}
