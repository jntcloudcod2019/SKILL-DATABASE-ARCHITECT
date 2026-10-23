// Canonical Schema Model (CSM) — format version 1.
// Must stay in sync with csm.schema.json (tests/schema.test.ts checks fixtures against both).

export const CSM_FORMAT_VERSION = '1.0';

export const MODEL_STATES = [
  'DISCOVERING',
  'ANALYZING',
  'DRAFT',
  'NEEDS_INPUT',
  'VALIDATING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'GENERATING',
  'GENERATED',
  'FAILED',
] as const;
export type ModelState = (typeof MODEL_STATES)[number];

export type Mode = 'greenfield' | 'brownfield' | 'evolution';

/** Where a piece of information came from. Drives the visual distinction in the Studio. */
export type Origin = 'user' | 'document' | 'code' | 'ai' | 'manual';
export type Confidence = 'confirmed' | 'high' | 'medium' | 'low';

export interface Evidence {
  source: Origin;
  file?: string;
  line?: number;
  excerpt?: string;
  note?: string;
}

export interface Provenance {
  origin: Origin;
  confidence?: Confidence;
  evidence?: Evidence[];
  rationale?: string;
  /** Set when a human changed the element in the Studio after it was proposed. */
  manuallyEdited?: boolean;
}

export type DomainType =
  | 'string'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'money'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'enum';

export interface Condition {
  /** e.g. "status in (DISPATCHED, DELIVERED)" — human-readable business condition. */
  condition: string;
  description?: string;
}

export interface DefaultValue {
  kind: 'literal' | 'expression';
  value: string;
}

export interface Attribute {
  id: string;
  name: string;
  column?: string;
  description?: string;
  domainType: DomainType;
  /** Intended physical type when it must differ from the dialect default (e.g. "varchar(14)"). */
  physicalType?: string;
  /** Column nullability (database). */
  nullable: boolean;
  /** Domain-level optionality: may the business concept exist without this value? */
  domainOptional: boolean;
  /** Conditional obligation by business state. Never collapse this into NOT NULL silently. */
  requiredWhen?: Condition[];
  primaryKey?: boolean;
  unique?: boolean;
  default?: DefaultValue;
  generated?: 'none' | 'identity' | 'uuid' | 'now' | 'computed';
  length?: number;
  precision?: number;
  scale?: number;
  enumRef?: string;
  allowedValues?: string[];
  constraints?: string[];
  derived?: boolean;
  /** "internal" or "external:<system>" when another system owns the value. */
  sourceOfTruth?: string;
  provenance: Provenance;
  questions?: string[];
}

export interface UniqueConstraint {
  id: string;
  name?: string;
  attributes: string[];
}

export interface CheckConstraint {
  id: string;
  name?: string;
  expression: string;
  description?: string;
}

export interface Entity {
  id: string;
  name: string;
  table?: string;
  description?: string;
  responsibility?: string;
  aggregate?: string;
  context?: string;
  kind: 'entity' | 'association' | 'reference';
  persistence: 'persistent' | 'not-persisted' | 'external';
  attributes: Attribute[];
  uniqueConstraints: UniqueConstraint[];
  checks: CheckConstraint[];
  audit?: boolean;
  tenantScoped?: boolean;
  estimatedRows?: number;
  provenance: Provenance;
  questions?: string[];
}

export type ReferentialAction = 'cascade' | 'restrict' | 'set-null' | 'no-action' | 'set-default';

/**
 * A relationship always points from the dependent side (holder of the foreign key)
 * to the principal side (referenced key). For N:N, `through` names the association entity.
 */
export interface Relationship {
  id: string;
  name?: string;
  description?: string;
  from: { entity: string; attributes: string[] };
  to: { entity: string; attributes: string[] };
  /** Cardinality read as dependent:principal. */
  cardinality: 'N:1' | '1:1' | 'N:N';
  /** True when every dependent must reference a principal (association mandatory). */
  required: boolean;
  identifying?: boolean;
  through?: string;
  onDelete: ReferentialAction;
  onUpdate?: ReferentialAction;
  provenance: Provenance;
}

export interface EnumType {
  id: string;
  name: string;
  values: string[];
  provenance: Provenance;
}

export interface Index {
  id: string;
  entity: string;
  name?: string;
  attributes: string[];
  unique: boolean;
  method?: 'btree' | 'hash' | 'gin' | 'gist';
  where?: string;
  rationale?: string;
  provenance: Provenance;
}

export interface ContractField {
  path: string;
  type: string;
  format?: string;
  /** Required when the contract is sent as a request body. */
  requiredInRequest?: boolean;
  /** Guaranteed present in the response. */
  requiredInResponse?: boolean;
  nullable?: boolean;
  description?: string;
}

export interface Contract {
  id: string;
  name: string;
  system: string;
  kind: 'openapi' | 'json-schema' | 'dto' | 'manual';
  direction: 'inbound' | 'outbound' | 'both';
  usage?: Array<'request' | 'response'>;
  fields: ContractField[];
  provenance: Provenance;
}

export interface ContractMapping {
  id: string;
  contract: string;
  field: string;
  entity?: string;
  attribute?: string;
  /** "stored", "derived", "ignored", "external-reference". */
  treatment: 'stored' | 'derived' | 'ignored' | 'external-reference';
  transform?: string;
  note?: string;
  provenance: Provenance;
}

export interface KnownQuery {
  id: string;
  name: string;
  entity: string;
  filters: string[];
  orderBy: string[];
  pagination?: 'none' | 'offset' | 'keyset';
  frequency?: 'high' | 'medium' | 'low';
  sql?: string;
  provenance: Provenance;
}

export interface Decision {
  id: string;
  title: string;
  context?: string;
  decision?: string;
  consequences?: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  provenance: Provenance;
}

export interface Question {
  id: string;
  text: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'answered' | 'deferred';
  answer?: string;
  options?: string[];
  consequences?: string;
  relatedTo?: string[];
  /** Conflicting sources that motivated the question (brownfield). */
  conflicts?: Evidence[];
  provenance: Provenance;
}

export interface Hypothesis {
  id: string;
  statement: string;
  status: 'unconfirmed' | 'confirmed' | 'rejected';
  consequences?: string;
  relatedTo?: string[];
  provenance: Provenance;
}

export interface Actor {
  id: string;
  name: string;
  description?: string;
  provenance: Provenance;
}

export interface Requirement {
  id: string;
  text: string;
  kind: 'functional' | 'non-functional' | 'constraint';
  provenance: Provenance;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  synonyms?: string[];
  provenance: Provenance;
}

export interface Concept {
  id: string;
  name: string;
  kind: 'entity' | 'value-object' | 'event' | 'actor' | 'external' | 'process';
  description?: string;
  context?: string;
  /** Why it deserves (or not) persistence: identity, lifecycle, history, query needs. */
  persistenceRationale?: string;
  mapsToEntity?: string;
  provenance: Provenance;
}

export interface ConceptRelation {
  id: string;
  from: string;
  to: string;
  label: string;
  multiplicity?: string;
  provenance: Provenance;
}

export interface BusinessRule {
  id: string;
  text: string;
  kind: 'invariant' | 'validation' | 'policy' | 'derivation';
  appliesTo?: string[];
  status: 'confirmed' | 'proposed' | 'question';
  provenance: Provenance;
}

export interface Lifecycle {
  id: string;
  concept: string;
  states: string[];
  transitions: Array<{ from: string; to: string; trigger?: string }>;
  provenance: Provenance;
}

export interface DomainEvent {
  id: string;
  name: string;
  description?: string;
  provenance: Provenance;
}

export interface BoundedContext {
  id: string;
  name: string;
  description?: string;
}

export interface Domain {
  problem?: string;
  goals: string[];
  actors: Actor[];
  requirements: Requirement[];
  glossary: GlossaryTerm[];
  concepts: Concept[];
  conceptRelations: ConceptRelation[];
  rules: BusinessRule[];
  lifecycles: Lifecycle[];
  events: DomainEvent[];
  contexts: BoundedContext[];
}

export interface Source {
  id: string;
  kind: 'description' | 'document' | 'openapi' | 'json-schema' | 'code';
  title: string;
  path?: string;
  importedAt: string;
  excerpt?: string;
}

export interface TechProfile {
  database?: 'postgresql' | 'sqlserver' | 'sqlite' | 'mysql';
  databaseVersion?: string;
  language?: string;
  framework?: string;
  persistence?: 'ef-core' | 'prisma' | 'dapper' | 'sql';
  migrationStrategy?: string;
  /** False until the user explicitly confirms the physical profile. */
  confirmed: boolean;
}

export interface Conventions {
  naming: 'snake_case' | 'PascalCase' | 'camelCase';
  primaryKeyStrategy: 'uuid' | 'identity' | 'ulid' | 'natural' | 'undecided';
  tenancy: { strategy: 'none' | 'column' | 'schema' | 'database' | 'undecided'; column?: string };
  auditColumns?: string[];
}

export interface Approval {
  stage: 'domain' | 'model';
  revision: number;
  hash: string;
  approvedAt: string;
  approvedBy: string;
  note?: string;
  invalidatedAt?: string;
}

export interface HistoryEntry {
  revision: number;
  at: string;
  author: Origin;
  summary: string;
  hash: string;
}

export interface ValidationSummary {
  hash: string;
  at: string;
  blocking: number;
  total: number;
}

export interface CanonicalModel {
  formatVersion: typeof CSM_FORMAT_VERSION;
  project: {
    id: string;
    name: string;
    mode: Mode;
    rootDir: string;
    description?: string;
    languages: string[];
    frameworks: string[];
    orm?: string;
    database?: string;
    profile: TechProfile;
  };
  status: {
    state: ModelState;
    revision: number;
    updatedAt: string;
    reviewedAt?: string;
    lastValidation?: ValidationSummary;
    failure?: string;
  };
  approvals: Approval[];
  conventions: Conventions;
  sources: Source[];
  domain: Domain;
  entities: Entity[];
  relationships: Relationship[];
  enums: EnumType[];
  indexes: Index[];
  contracts: Contract[];
  mappings: ContractMapping[];
  queries: KnownQuery[];
  decisions: Decision[];
  questions: Question[];
  hypotheses: Hypothesis[];
  history: HistoryEntry[];
}

export type Severity =
  | 'critical'
  | 'modeling'
  | 'domain'
  | 'integrity'
  | 'performance'
  | 'warning'
  | 'pending-decision'
  | 'suggestion';

/**
 * A structured, deterministic correction attached to a validation issue. Applying it is always a user action;
 * it is recorded as a manual edit. Actions (not raw ops) so several fixes on the same entity compose safely.
 */
export type FixAction =
  | { type: 'setAttribute'; entity: string; attribute: string; set: Partial<Attribute>; unset?: Array<keyof Attribute> }
  | { type: 'addAttribute'; entity: string; attribute: Attribute }
  | { type: 'setRelationship'; relationship: string; set: Partial<Relationship> }
  | { type: 'addIndex'; index: Index }
  | { type: 'removeIndex'; id: string }
  | { type: 'setItem'; collection: 'questions' | 'hypotheses'; id: string; set: Record<string, unknown> };

export interface Fix {
  /** Stable per rule, so the Studio can offer "apply to all" for issues that share rule + fix id. */
  id: string;
  label: string;
  description: string;
  /** True when this option is a judgment call on a business decision rather than a mechanical correction. */
  decision?: boolean;
  actions: FixAction[];
}

export interface Issue {
  id: string;
  rule: string;
  category: string;
  severity: Severity;
  blocking: boolean;
  message: string;
  target?: { kind: string; id: string; entity?: string };
  evidence?: Evidence[];
  rationale: string;
  recommendation: string;
  fixes?: Fix[];
}
