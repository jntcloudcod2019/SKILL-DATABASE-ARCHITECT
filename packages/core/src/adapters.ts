// Stable adapter contracts. New technologies plug in here without touching engine rules.
import type { CanonicalModel, Contract, Evidence, Issue, KnownQuery, ReferentialAction } from './types.ts';

export interface ScannedFile {
  /** Path relative to the authorized root, always with forward slashes. */
  path: string;
  content: string;
}

export interface Technology {
  kind: 'language' | 'framework' | 'orm' | 'database' | 'format';
  name: string;
  version?: string;
  evidence: Evidence[];
}

export interface FactColumn {
  name: string;
  /** Property/field name in code when different from the column. */
  property?: string;
  type: string;
  domainType?: import('./types.ts').DomainType;
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: string;
  generated?: 'identity' | 'uuid' | 'now';
  length?: number;
  precision?: number;
  scale?: number;
  enumRef?: string;
  /** Extra human-readable detail, e.g. the inner shape of a JSON column. */
  description?: string;
  evidence: Evidence[];
}

export interface FactTable {
  name: string;
  entityName?: string;
  source: string;
  columns: FactColumn[];
  indexes: Array<{ columns: string[]; unique: boolean; name?: string }>;
  evidence: Evidence[];
}

export interface FactRelation {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: 'N:1' | '1:1';
  onDelete?: ReferentialAction;
  source: string;
  evidence: Evidence[];
}

export interface Facts {
  technologies: Technology[];
  tables: FactTable[];
  relations: FactRelation[];
  enums: Array<{ name: string; values: string[]; evidence: Evidence[] }>;
  contracts: Contract[];
  queries: Array<Omit<KnownQuery, 'entity' | 'filters' | 'orderBy'> & { table: string; filters: string[]; orderBy: string[] }>;
  migrations: Array<{ file: string; tool: string; name: string }>;
  documents: Array<{ file: string; title: string; headings: string[] }>;
  connections: Array<{ file: string; provider: string; key: string }>;
  unparsed: Array<{ file: string; reason: string }>;
  limitations: string[];
}

export function emptyFacts(): Facts {
  return {
    technologies: [],
    tables: [],
    relations: [],
    enums: [],
    contracts: [],
    queries: [],
    migrations: [],
    documents: [],
    connections: [],
    unparsed: [],
    limitations: [],
  };
}

/** Detectors, extractors, ORM interpreters and contract interpreters all implement Analyzer. */
export interface Analyzer {
  id: string;
  category: 'detector' | 'extractor' | 'orm' | 'contract' | 'docs' | 'config';
  /** Cheap filter: return true for files this analyzer wants to read. */
  accepts(path: string): boolean;
  analyze(files: ScannedFile[]): Partial<Facts>;
}

export interface Dialect {
  id: 'postgresql' | 'sqlserver' | 'sqlite' | 'mysql';
  quote(name: string): string;
  columnType(attr: import('./types.ts').Attribute, model: CanonicalModel): string;
  /** Hard limits used by the type validators. */
  maxVarchar?: number;
  maxDecimalPrecision: number;
  supportsCheck: boolean;
}

export interface GeneratedFile {
  /** Proposed path relative to the project root. */
  path: string;
  content: string;
  kind: 'schema' | 'migration' | 'code' | 'doc' | 'config';
}

export interface GeneratorInput {
  model: CanonicalModel;
  revision: number;
  hash: string;
  dialect: Dialect['id'];
  targetVersion?: string;
  previous?: CanonicalModel;
  options: Record<string, unknown>;
}

export interface GeneratorReport {
  notes: string[];
  warnings: string[];
  unsupported: string[];
}

export interface Generator {
  id: 'sql' | 'prisma' | 'ef-core' | 'dapper' | string;
  description: string;
  dialects: Array<Dialect['id']>;
  generate(input: GeneratorInput): { files: GeneratedFile[]; report: GeneratorReport };
}

export interface TechValidator {
  id: string;
  appliesTo(model: CanonicalModel): boolean;
  validate(model: CanonicalModel): Issue[];
}
