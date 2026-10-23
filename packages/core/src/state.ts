import type { ModelState } from './types.ts';

/** Explicit state machine. Anything not listed is rejected, so analysis can never jump straight to generation. */
export const TRANSITIONS: Record<ModelState, readonly ModelState[]> = {
  DISCOVERING: ['ANALYZING', 'DRAFT', 'NEEDS_INPUT', 'FAILED'],
  ANALYZING: ['DRAFT', 'NEEDS_INPUT', 'FAILED'],
  DRAFT: ['DRAFT', 'ANALYZING', 'VALIDATING', 'NEEDS_INPUT'],
  NEEDS_INPUT: ['DRAFT', 'ANALYZING', 'VALIDATING', 'NEEDS_INPUT'],
  VALIDATING: ['DRAFT', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'FAILED'],
  READY_FOR_REVIEW: ['APPROVED', 'DRAFT', 'VALIDATING'],
  APPROVED: ['GENERATING', 'DRAFT', 'VALIDATING'],
  GENERATING: ['GENERATED', 'FAILED'],
  GENERATED: ['GENERATING', 'DRAFT', 'VALIDATING'],
  FAILED: ['DRAFT', 'ANALYZING', 'GENERATING', 'VALIDATING'],
};

export class InvalidTransitionError extends Error {
  from: ModelState;
  to: ModelState;
  constructor(from: ModelState, to: ModelState) {
    super(`Invalid state transition ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ModelState, to: ModelState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ModelState, to: ModelState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
