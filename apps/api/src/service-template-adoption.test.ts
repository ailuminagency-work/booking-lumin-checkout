import { describe, expect, it } from 'vitest';
import { listTemplates } from '@lumin/templates';
import { adoptServiceTemplate, type AdoptionClient, type AdoptionPool } from './service-template-adoption';

const actor = { userId: '11111111-1111-4111-8111-111111111111' };
const tenantId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = 'safe_fixed_key_123456789';

function harness(key: string, override?: (sql: string, values?: unknown[]) => Promise<any>) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const releases: (Error | undefined)[] = [];
  const client: AdoptionClient = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (override) return override(sql, values);
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [{ currency: 'USD', timezone: 'America/Chicago' }] };
      if (sql.startsWith('SELECT public.ingest_service_draft')) return { command: 'SELECT', rows: [{ result: { serviceId, templateKey: key, active: false } }] };
      return { command: sql === 'COMMIT' ? 'COMMIT' : sql.startsWith('BEGIN') ? 'BEGIN' : sql.startsWith('SET') ? 'SET' : 'SELECT', rows: [{}] };
    },
    release(error) { releases.push(error); },
  };
  const pool: AdoptionPool = { async connect() { return client; } };
  return { pool, calls, releases, request: { tenantId, templateKey: key, idempotencyKey } };
}

describe('server-authoritative template adoption', () => {
  it.each(listTemplates().map(t => t.key))('builds canonical %s without forwarding authority fields', async key => {
    const h = harness(key);
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toEqual({ kind: 'committed', serviceId, templateKey: key, active: false });
    const rpc = h.calls.find(c => c.sql.startsWith('SELECT public.ingest_service_draft'))!;
    expect(rpc.values?.slice(0, 4)).toEqual([actor.userId, tenantId, idempotencyKey, key]);
    const body = JSON.parse(rpc.values![4] as string);
    expect(Object.keys(body)).not.toContain('id');
    expect(Object.keys(body)).not.toContain('tenantId');
    expect(Object.keys(body)).not.toContain('currency');
    expect(Object.keys(body)).not.toContain('active');
    expect(body.name).toBeTruthy();
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
    expect(h.releases).toEqual([undefined]);
  });

  it.each(['constructor', 'prototype', '__proto__', 'unknown', ''])('rejects unregistered key %s before connecting', async key => {
    const h = harness(key);
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toMatchObject({ kind: 'failed', code: 'INVALID_REQUEST' });
    expect(h.calls).toHaveLength(0);
  });

  it('rejects forged input shape and extra browser service JSON', async () => {
    const h = harness('housekeeping');
    expect(await adoptServiceTemplate(h.pool, { ...actor, tenantId }, h.request)).toMatchObject({ kind: 'failed', code: 'INVALID_REQUEST' });
    expect(await adoptServiceTemplate(h.pool, actor, { ...h.request, service: { active: true } })).toMatchObject({ kind: 'failed', code: 'INVALID_REQUEST' });
    expect(h.calls).toHaveLength(0);
  });

  it('does not reach ingestion after owner revocation', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [] };
      return { command: sql.startsWith('BEGIN') ? 'BEGIN' : 'SET', rows: [] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toMatchObject({ kind: 'failed', code: 'FORBIDDEN', transaction: 'not_committed' });
    expect(h.calls.some(c => c.sql.includes('ingest_service_draft'))).toBe(false);
    expect(h.releases[0]).toBeInstanceOf(Error);
  });

  it('forwards the same idempotency key on an identical retry', async () => {
    const h = harness('housekeeping');
    await adoptServiceTemplate(h.pool, actor, h.request);
    await adoptServiceTemplate(h.pool, actor, h.request);
    expect(h.calls.filter(c => c.sql.includes('ingest_service_draft')).map(c => c.values?.[2])).toEqual([idempotencyKey, idempotencyKey]);
  });

  it('maps fixed RPC conflict and withholds commit', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.includes('ingest_service_draft')) throw Object.assign(new Error('SERVICE_DRAFT_CONFLICT'), { code: '40001' });
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [{ currency: 'USD', timezone: 'America/Chicago' }] };
      return { command: sql.startsWith('BEGIN') ? 'BEGIN' : sql.startsWith('SET') ? 'SET' : 'SELECT', rows: [{}] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toMatchObject({ kind: 'failed', code: 'CONFLICT' });
    expect(h.calls.some(c => c.sql === 'COMMIT')).toBe(false);
  });

  it('rejects a malformed or mismatched receipt before commit', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [{ currency: 'USD', timezone: 'America/Chicago' }] };
      if (sql.includes('ingest_service_draft')) return { command: 'SELECT', rows: [{ result: { serviceId, templateKey: 'car-detailing', active: true } }] };
      return { command: sql.startsWith('BEGIN') ? 'BEGIN' : sql.startsWith('SET') ? 'SET' : 'SELECT', rows: [{}] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toMatchObject({ kind: 'failed', code: 'INTERNAL_ERROR' });
    expect(h.calls.some(c => c.sql === 'COMMIT')).toBe(false);
  });

  it('reports a lost commit acknowledgement as uncertain with the original key', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [{ currency: 'USD', timezone: 'America/Chicago' }] };
      if (sql.includes('ingest_service_draft')) return { command: 'SELECT', rows: [{ result: { serviceId, templateKey: 'housekeeping', active: false } }] };
      if (sql === 'COMMIT') throw Error('disconnect');
      return { command: sql.startsWith('BEGIN') ? 'BEGIN' : sql.startsWith('SET') ? 'SET' : 'SELECT', rows: [{}] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toEqual({ kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_OR_LOOKUP_WITH_SAME_KEY' });
    expect(h.releases[0]).toBeInstanceOf(Error);
  });

  it('treats a server rollback response as not committed', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.startsWith('SELECT t.currency')) return { command: 'SELECT', rows: [{ currency: 'USD', timezone: 'America/Chicago' }] };
      if (sql.includes('ingest_service_draft')) return { command: 'SELECT', rows: [{ result: { serviceId, templateKey: 'housekeeping', active: false } }] };
      return { command: sql === 'COMMIT' ? 'ROLLBACK' : sql.startsWith('BEGIN') ? 'BEGIN' : sql.startsWith('SET') ? 'SET' : 'SELECT', rows: [{}] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toEqual({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'not_committed' });
  });

  it('does not report success after a pre-commit provider disconnect', async () => {
    const h = harness('housekeeping', async sql => {
      if (sql.startsWith('SELECT t.currency')) throw Error('provider disconnect');
      return { command: sql.startsWith('BEGIN') ? 'BEGIN' : 'SET', rows: [] };
    });
    expect(await adoptServiceTemplate(h.pool, actor, h.request)).toEqual({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'not_committed' });
    expect(h.calls.some(c => c.sql === 'COMMIT')).toBe(false);
    expect(h.releases[0]).toBeInstanceOf(Error);
  });

  it('classifies acquisition failure without issuing a transaction', async () => {
    const h = harness('housekeeping');
    const broken: AdoptionPool = { async connect() { throw Error('provider down'); } };
    expect(await adoptServiceTemplate(broken, actor, h.request)).toMatchObject({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'not_started' });
  });
});

