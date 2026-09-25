import { expect, it, vi } from 'vitest';
import { projectWorkerJob, WORKER_JOB_TRANSITIONS, type WorkerAuthorizationInput, type WorkerJobState } from '../src/worker';
import { parseWorkerJobProjection } from '../src/workerProjection';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const workerId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const assignmentId = '55555555-5555-4555-8555-555555555555';
function context(): WorkerAuthorizationInput {
  return {
    actor: { tenantId, userId, workerId, sessionActive: true },
    access: { tenantId, userId, workerId, active: true, workerActive: true, revokedAt: null, permissionVersion: 3 },
    assignment: { id: assignmentId, tenantId, jobId, userId, workerId, active: true, revokedAt: null, version: 7, accessStartsAt: '2030-01-01T09:00:00Z', accessEndsAt: '2030-01-01T12:00:00Z' },
    job: { id: jobId, tenantId, state: 'ASSIGNED', active: true, version: 4, reference: 'JOB-1', serviceLabel: 'Synthetic service', slotStart: '2030-01-01T10:00:00Z', slotEnd: '2030-01-01T11:00:00Z', timeZone: 'Europe/Paris' },
    request: { jobId, assignmentId, expectedPermissionVersion: 3, expectedAssignmentVersion: 7, expectedJobVersion: 4 },
    now: '2030-01-01T09:30:00Z',
  };
}
function projected(state: WorkerJobState = 'ASSIGNED') {
  const input = context(); input.job.state = state;
  const result = projectWorkerJob(input);
  if (!result.allowed) throw Error('Fixture denied');
  return result.job;
}
const rejects = (value: unknown) => expect(() => parseWorkerJobProjection(value)).toThrow(/^INVALID_WORKER_JOB_PROJECTION$/);

it.each(['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] as const)('accepts the actual producer projection for %s', state => {
  const value = projected(state);
  const parsed = parseWorkerJobProjection(value);
  expect(parsed).toEqual(value);
  expect(parsed.allowedTransitions).toEqual(WORKER_JOB_TRANSITIONS[state]);
  expect(Object.keys(parsed).sort()).toEqual(Object.keys(value).sort());
});
it('rejects a denied projection decision and unknown sensitive fields', () => {
  const input = context(); input.access.active = false;
  rejects(projectWorkerJob(input));
  for (const extra of [{ price: 100 }, { customerEmail: 'secret@example.test' }, { gateCode: '1234' }, { privateNotes: 'secret' }, { uploadedPhotoUrl: 'https://example.test' }]) rejects({ ...projected(), ...extra });
  for (const key of Object.keys(projected())) { const value: Record<string, unknown> = { ...projected() }; delete value[key]; rejects(value); }
});
it('rejects malformed identities, versions, times, zone and state using producer semantics', () => {
  for (const key of ['jobId', 'assignmentId']) rejects({ ...projected(), [key]: 'not-a-uuid' });
  for (const key of ['permissionVersion', 'assignmentVersion', 'jobVersion'])
    for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) rejects({ ...projected(), [key]: version });
  for (const slotStart of ['2030-02-30T10:00:00Z', 'bad', '2030-01-01T10:00:00']) rejects({ ...projected(), slotStart });
  rejects({ ...projected(), slotEnd: projected().slotStart });
  rejects({ ...projected(), timeZone: 'Unknown/Zone' });
  rejects({ ...projected(), state: 'CANCELLED' });
  expect(parseWorkerJobProjection({ ...projected(), timeZone: 'UTC' }).timeZone).toBe('UTC');
});
it('requires the exact transition policy with no duplicate, accessor or inherited list', () => {
  const value = projected();
  for (const allowedTransitions of [[], ['ARRIVED'], ['EN_ROUTE', 'EN_ROUTE'], ['COMPLETED']]) rejects({ ...value, allowedTransitions });
  const getter = vi.fn(() => 'EN_ROUTE');
  const accessor = ['EN_ROUTE']; Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
  rejects({ ...value, allowedTransitions: accessor });
  expect(getter).not.toHaveBeenCalled();
  rejects({ ...value, allowedTransitions: Object.assign(Object.create([]), { 0: 'EN_ROUTE', length: 1 }) });
});
it('detaches and freezes output without invoking hostile getters or proxy reads', () => {
  const value = { ...projected(), allowedTransitions: ['EN_ROUTE'] };
  const parsed = parseWorkerJobProjection(value);
  value.allowedTransitions[0] = 'ARRIVED';
  expect(parsed.allowedTransitions).toEqual(['EN_ROUTE']);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.allowedTransitions)).toBe(true);
  const getter = vi.fn(() => 'private');
  const accessor = Object.defineProperty({ ...projected() }, 'reference', { enumerable: true, get: getter });
  rejects(accessor); expect(getter).not.toHaveBeenCalled();
  const read = vi.fn(() => 'private');
  expect(parseWorkerJobProjection(new Proxy(projected(), { get: read }))).toEqual(projected());
  expect(read).not.toHaveBeenCalled();
  rejects(new Proxy({}, { getPrototypeOf() { throw Error('private'); } }));
  const cyclic: Record<string, unknown> = { ...projected() }; cyclic.jobId = cyclic; rejects(cyclic);
});
