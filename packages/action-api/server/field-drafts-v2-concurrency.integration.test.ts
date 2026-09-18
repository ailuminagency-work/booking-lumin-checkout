import { expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { configuration, corpus, CASE_COUNT, initialReceipt, SNAPSHOT_SQL } from './field-drafts-v2-concurrency.integration';
import { parseFieldDocumentV2 } from '@lumin/workflow';
const env = () => ({ FIELD_DRAFT_V2_CONCURRENCY_APPROVED: '1', TEXT_DRAFT_CONCURRENCY_APPROVED: '1', TEXT_DRAFT_CONCURRENCY_DATABASE: 'lumin_text_draft_' + 'a'.repeat(32), TEXT_DRAFT_TEST_PROFILE: 'local', TEXT_DRAFT_TEST_LAYOUT: 'public', TEXT_DRAFT_TEST_DISPOSABLE: '1' });
it('import is inert and exposes finite failed default receipt', async () => {
 const connect = vi.spyOn(Client.prototype, 'connect');
 try { await import('./field-drafts-v2-concurrency.integration'); expect(connect).not.toHaveBeenCalled(); } finally { connect.mockRestore(); }
 expect(initialReceipt()).toEqual({ schemaVersion: 1, kind: 'FIELD_DRAFT_V2_CONCURRENCY', status: 'failed', category: 'CONFIGURATION_FAILED', cases: 0, parityCases: 0, connectionsClosed: false });
 expect(CASE_COUNT).toBe(14);
 expect(SNAPSHOT_SQL).toBe('select pg_current_snapshot()');
});
it('requires both approvals and the disposable profile before any connection', async () => {
 for (const patch of [{ FIELD_DRAFT_V2_CONCURRENCY_APPROVED: '0' }, { TEXT_DRAFT_CONCURRENCY_APPROVED: '0' }, { TEXT_DRAFT_TEST_DISPOSABLE: '0' }, { TEXT_DRAFT_CONCURRENCY_DATABASE: 'postgres' }, { TEXT_DRAFT_TEST_LAYOUT: 'other' }]) expect(() => configuration({ ...env(), ...patch }, 'win32')).toThrow();
 const config = configuration({ ...env(), PGHOST: 'external', PGPASSWORD: 'private', PGOPTIONS: 'unsafe' }, 'win32');
 expect(config.host).toBe('127.0.0.1'); expect(config.port).toBe(55439); expect(config.options).toBe(''); expect(config.ssl).toBe(false);
 expect(config.statement_timeout).toBe(7000); expect(config.lock_timeout).toBe(5000); expect(config.query_timeout).toBe(9000); expect(config.idle_in_transaction_session_timeout).toBe(10000);
 expect(typeof config.password).toBe('function'); if (typeof config.password === 'function') expect(await config.password()).toBe('');
});
it('accepts only explicit Linux CI and both crypto layouts', async () => {
 for (const layout of ['public', 'extensions']) {
  const config = configuration({ ...env(), TEXT_DRAFT_TEST_PROFILE: 'github-ci', GITHUB_ACTIONS: 'true', TEXT_DRAFT_TEST_LAYOUT: layout }, 'linux');
  expect(config.port).toBe(5432); if (typeof config.password === 'function') expect(await config.password()).toBe('postgres');
 }
 expect(() => configuration(env(), 'linux')).toThrow(); expect(() => configuration({ ...env(), TEXT_DRAFT_TEST_PROFILE: 'github-ci' }, 'linux')).toThrow();
});
it('pins32 JSON-safe parity cases with both accepted and rejected boundaries', () => {
 const entries = corpus(); expect(entries).toHaveLength(32); let valid = 0, invalid = 0;
 for (const entry of entries) { const wire = JSON.parse(JSON.stringify(entry)); try { parseFieldDocumentV2(wire); valid++; } catch { invalid++; } }
 expect(valid).toBeGreaterThan(0); expect(invalid).toBeGreaterThan(0);
 const lengths = entries.flatMap(entry => entry && typeof entry === 'object' && 'fields' in entry && Array.isArray(entry.fields) ? [entry.fields.length] : []);
 expect(lengths).toContain(64); expect(lengths).toContain(65);
});
