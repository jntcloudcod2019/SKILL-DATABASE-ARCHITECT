import { createRequire } from 'node:module';
import type { Generator, GeneratedFile } from '@dbarchitect/core';
import { sqlGenerator } from '@dbarchitect/adapter-sql';
import { prismaGenerator } from '@dbarchitect/adapter-prisma';
import { efCoreGenerator } from '@dbarchitect/adapter-ef-core';
import { dapperGenerator } from '@dbarchitect/adapter-dapper';

export const generators: Record<string, Generator> = {
  sql: sqlGenerator,
  prisma: prismaGenerator,
  'ef-core': efCoreGenerator,
  dapper: dapperGenerator,
};

/** Supported (target × dialect) pairs actually implemented and tested. Mirrors docs/support-matrix.md. */
export const SUPPORT: Array<{ target: string; dialect: string; verification: string }> = [
  { target: 'sql', dialect: 'sqlite', verification: 'DDL executado em SQLite em memória (node:sqlite) — verificação real' },
  { target: 'sql', dialect: 'postgresql', verification: 'Gerado e coberto por testes de snapshot; não executado (sem PostgreSQL)' },
  { target: 'sql', dialect: 'sqlserver', verification: 'Gerado e coberto por testes de snapshot; não executado' },
  { target: 'sql', dialect: 'mysql', verification: 'Gerado e coberto por testes de snapshot; não executado' },
  { target: 'prisma', dialect: 'postgresql', verification: 'prisma validate se o CLI estiver disponível; senão apenas estrutura' },
  { target: 'prisma', dialect: 'sqlite', verification: 'prisma validate se o CLI estiver disponível' },
  { target: 'ef-core', dialect: 'postgresql', verification: 'dotnet build se SDK e pacotes NuGet estiverem disponíveis' },
  { target: 'ef-core', dialect: 'sqlserver', verification: 'dotnet build se disponível' },
  { target: 'ef-core', dialect: 'sqlite', verification: 'dotnet build se disponível' },
  { target: 'dapper', dialect: 'sqlite', verification: 'DDL verificado em SQLite; C# via dotnet build se disponível' },
  { target: 'dapper', dialect: 'postgresql', verification: 'DDL por snapshot; C# via dotnet build se disponível' },
  { target: 'dapper', dialect: 'sqlserver', verification: 'DDL por snapshot; C# via dotnet build se disponível' },
];

export interface VerificationResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
}

/** Executes generated SQLite DDL in an in-memory database. Nothing touches disk or any shared database. */
export function verifySqliteDdl(files: GeneratedFile[]): VerificationResult {
  const f = files.find((x) => x.path.endsWith('.sql'));
  if (!f) return { name: 'sqlite-ddl', status: 'skipped', detail: 'sem arquivo SQL' };
  // Lazy require keeps node:sqlite's experimental warning out of runs that never verify SQL.
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(f.content);
    const n = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
    return { name: 'sqlite-ddl', status: 'passed', detail: `DDL executado em SQLite em memória: ${n} tabela(s) criada(s).` };
  } catch (e) {
    return { name: 'sqlite-ddl', status: 'failed', detail: (e as Error).message };
  } finally {
    db.close();
  }
}
