import { z } from 'zod';
import { WorkerJobState, WORKER_JOB_TRANSITIONS, type WorkerJobProjection } from './worker';

const invalid = (): never => { throw new Error('INVALID_WORKER_JOB_PROJECTION'); };
const Id = z.string().uuid();
const Version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
// Match the producer's worker.ts Instant and Zone semantics exactly.
const Instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const Zone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
});
const scalar = z.object({
  jobId: Id, assignmentId: Id, reference: z.string().min(1).max(64),
  serviceLabel: z.string().min(1).max(160), state: WorkerJobState,
  slotStart: Instant, slotEnd: Instant, timeZone: Zone,
  permissionVersion: Version, assignmentVersion: Version, jobVersion: Version,
}).strict().refine(value => Date.parse(value.slotEnd) > Date.parse(value.slotStart));
const keys = [
  'jobId', 'assignmentId', 'reference', 'serviceLabel', 'state',
  'slotStart', 'slotEnd', 'timeZone', 'permissionVersion',
  'assignmentVersion', 'jobVersion', 'allowedTransitions',
] as const;
function ownData(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== expected.length || own.some(key => typeof key !== 'string' || !expected.includes(key))) return invalid();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}
function transitions(value: unknown, state: WorkerJobState): readonly WorkerJobState[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  const expected = WORKER_JOB_TRANSITIONS[state];
  if (length !== expected.length || Reflect.ownKeys(value).length !== length + 1) return invalid();
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value !== expected[index]) return invalid();
  }
  return Object.freeze([...expected]);
}

/** Strict wire validation only; current worker authorization must be checked by the server. */
export function parseWorkerJobProjection(input: unknown): WorkerJobProjection {
  try {
    const data = ownData(input, keys);
    const { allowedTransitions, ...values } = data;
    const parsed = scalar.safeParse(values);
    if (!parsed.success) return invalid();
    return Object.freeze({ ...parsed.data, allowedTransitions: transitions(allowedTransitions, parsed.data.state) });
  } catch { return invalid(); }
}
