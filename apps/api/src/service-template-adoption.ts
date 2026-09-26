import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { Service } from '@lumin/contracts';
import { templateRegistry } from '@lumin/templates';

export interface AdoptionClient {
  query(text: string, values?: unknown[]): Promise<{ command: string; rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(error?: Error): void;
}
export interface AdoptionPool { connect(): Promise<AdoptionClient> }
export type AdoptionOutcome =
  | { kind: 'committed'; serviceId: string; templateKey: string; active: false }
  | { kind: 'failed'; code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE' | 'DEADLINE' | 'INTERNAL_ERROR'; transaction: 'not_started' | 'not_committed' }
  | { kind: 'unknown_commit'; code: 'COMMIT_UNCERTAIN'; reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9-]{0,99}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_MS = 10_000;

function record(input: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)) return null;
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== names.length ||
      names.some(name => !Object.hasOwn(input, name))) return null;
    const copied: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      copied[name] = descriptor.value;
    }
    return copied;
  } catch { return null; }
}

function errorCode(error: unknown): 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR' {
  if (error && typeof error === 'object' && !types.isProxy(error)) {
    const code = Reflect.getOwnPropertyDescriptor(error, 'code')?.value;
    const message = Reflect.getOwnPropertyDescriptor(error, 'message')?.value;
    if (code === '42501' && message === 'FORBIDDEN') return 'FORBIDDEN';
    if (code === '40001' && (message === 'SERVICE_DRAFT_CONFLICT' || message === 'SERVICE_DRAFT_STATE_CHANGED')) return 'CONFLICT';
    if (code === 'P0002') return 'UNAVAILABLE';
  }
  return 'INTERNAL_ERROR';
}

/** Server-only seam. Caller identity must already be verified by the authentication boundary. */
export async function adoptServiceTemplate(pool: AdoptionPool, actorInput: unknown, requestInput: unknown): Promise<AdoptionOutcome> {
  const actor = record(actorInput, ['userId']);
  const request = record(requestInput, ['tenantId', 'templateKey', 'idempotencyKey']);
  if (!actor || !request || typeof actor.userId !== 'string' || !UUID.test(actor.userId) ||
    typeof request.tenantId !== 'string' || !UUID.test(request.tenantId) ||
    typeof request.templateKey !== 'string' || !KEY.test(request.templateKey) ||
    typeof request.idempotencyKey !== 'string' || !IDEMPOTENCY.test(request.idempotencyKey) ||
    !Object.hasOwn(templateRegistry, request.templateKey)) {
    return { kind: 'failed', code: 'INVALID_REQUEST', transaction: 'not_started' };
  }
  const template = templateRegistry[request.templateKey];
  if (!template || template.key !== request.templateKey) return { kind: 'failed', code: 'INVALID_REQUEST', transaction: 'not_started' };
  const templateKey = request.templateKey as string;
  const tenantId = request.tenantId as string;
  const idempotencyKey = request.idempotencyKey as string;
  const userId = actor.userId as string;
  const started = performance.now();
  let client: AdoptionClient | undefined;
  let submittedCommit = false;
  let beginSent = false;
  let released = false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const discard = () => {
    if (client && !released) { released = true; try { client.release(new Error('SERVICE_ADOPTION_CONNECTION_DISCARDED')); } catch { /* preserve conservative outcome */ } }
  };
  const remaining = () => MAX_MS - (performance.now() - started);
  const ensureTime = () => { if (expired || remaining() <= 0) throw new Error('ADOPTION_DEADLINE'); };
  const command = async (sql: string, expected: string, values?: unknown[]) => {
    ensureTime();
    const result = await client!.query(sql, values);
    ensureTime();
    if (result.command !== expected) throw new Error('ADOPTION_COMMAND_TAG');
    return result;
  };
  // A timeout discards the physical connection, including an in-flight COMMIT.
  const work = (async (): Promise<AdoptionOutcome> => {
    try {
      client = await pool.connect();
      ensureTime();
      beginSent = true;
      await command('BEGIN ISOLATION LEVEL READ COMMITTED', 'BEGIN');
      for (const sql of ["SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role']) await command(sql, 'SET');
      const context = await command(
        "SELECT t.currency,t.timezone FROM public.tenants t JOIN public.tenant_members m ON m.tenant_id=t.id AND m.user_id=$2::uuid AND m.role='BUSINESS_OWNER' WHERE t.id=$1::uuid AND t.status='active' FOR SHARE OF t,m",
        'SELECT', [tenantId, userId]);
      if (context.rows.length !== 1) return { kind: 'failed', code: 'FORBIDDEN', transaction: 'not_committed' };
      const { currency, timezone } = context.rows[0]!;
      if (typeof currency !== 'string' || typeof timezone !== 'string') throw Error('INVALID_TENANT_CONTEXT');
      const service = Service.parse(template.build({ tenantId, currency, timezone }));
      if (service.tenantId !== tenantId || service.currency !== currency || service.archetype !== template.archetype) throw Error('INVALID_TEMPLATE');
      const { id: _id, tenantId: _tenantId, currency: _currency, active: _active, ...payload } = service;
      const rpc = await command('SELECT public.ingest_service_draft($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result',
        'SELECT', [userId, tenantId, idempotencyKey, templateKey, JSON.stringify(payload)]);
      const receipt = rpc.rows[0]?.result;
      if (rpc.rows.length !== 1 || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || types.isProxy(receipt)) throw Error('INVALID_RECEIPT');
      const r = receipt as Record<string, unknown>;
      if (Reflect.ownKeys(r).length !== 3 || !Object.hasOwn(r, 'serviceId') || !Object.hasOwn(r, 'templateKey') || !Object.hasOwn(r, 'active') ||
        typeof r.serviceId !== 'string' || !UUID.test(r.serviceId) || r.templateKey !== templateKey || r.active !== false) throw Error('INVALID_RECEIPT');
      await command('SET CONSTRAINTS ALL IMMEDIATE', 'SET');
      ensureTime();
      submittedCommit = true;
      const commit = await client.query('COMMIT');
      if (expired) return { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' };
      if (commit.command === 'ROLLBACK') return { kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'not_committed' };
      if (commit.command !== 'COMMIT') return { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' };
      if (!released) { released = true; client.release(); }
      return { kind: 'committed', serviceId: r.serviceId as string, templateKey, active: false };
    } catch (error) {
      if (submittedCommit) return { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' };
      return { kind: 'failed', code: expired ? 'DEADLINE' : errorCode(error), transaction: beginSent ? 'not_committed' : 'not_started' };
    } finally { discard(); }
  })();
  const deadline = new Promise<AdoptionOutcome>(resolve => {
    timer = setTimeout(() => {
      expired = true; discard();
      resolve(submittedCommit
        ? { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' }
        : { kind: 'failed', code: 'DEADLINE', transaction: beginSent ? 'not_committed' : 'not_started' });
    }, Math.max(1, remaining()));
  });
  return Promise.race([work, deadline]).finally(() => { if (timer) clearTimeout(timer); });
}
