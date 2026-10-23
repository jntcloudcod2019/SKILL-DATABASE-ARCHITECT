import { Ajv } from 'ajv';
import schema from './csm.schema.json' with { type: 'json' };
import type { CanonicalModel } from './types.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export const csmSchema = schema;

export function validateSchema(model: unknown): { valid: boolean; errors: string[] } {
  const valid = validate(model) as boolean;
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}`,
  );
  return { valid, errors };
}

export class SchemaError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`Model does not match CSM schema: ${errors.slice(0, 5).join('; ')}`);
    this.errors = errors;
  }
}

export function assertSchema(model: unknown): asserts model is CanonicalModel {
  const r = validateSchema(model);
  if (!r.valid) throw new SchemaError(r.errors);
}
