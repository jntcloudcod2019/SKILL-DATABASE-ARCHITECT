import type { Generator, GeneratorInput } from '@dbarchitect/core';
import { dialects } from './dialects.ts';
import { generateDdl } from './ddl.ts';

export * from './dialects.ts';
export * from './ddl.ts';

export const sqlGenerator: Generator = {
  id: 'sql',
  description: 'DDL nativo (tabelas, PK, FK, unicidade, CHECK, índices, defaults) para PostgreSQL, SQL Server, MySQL e SQLite.',
  dialects: ['postgresql', 'sqlserver', 'mysql', 'sqlite'],
  generate(input: GeneratorInput) {
    const d = dialects[input.dialect];
    const { sql, report } = generateDdl(input.model, d);
    return {
      files: [{ path: `database/schema.${d.id}.sql`, content: sql, kind: 'schema' }],
      report,
    };
  },
};
