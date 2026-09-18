import { expect, it, vi } from 'vitest';
import { createFieldDraftV2Repository, type FieldDraftV2PgClient } from './field-drafts-v2-repository';
const actor = '11111111-1111-4111-8111-111111111111', tenant = '22222222-2222-4222-8222-222222222222', flow = '33333333-3333-4333-8333-333333333333';
const definition = () => ({ schemaVersion: 2, fields: [{ key: 'notes', kind: 'textarea', prompt: '  Exact \u{1f30d} e\u0301  ', required: false, minLength: 0, maxLength: 50 }] });
const receipt = () => ({ fieldDraftVersion: 2, parentAuthoringVersion: 2, draftRevision: 3, savedParentRevision: 5, currentParentRevision: 5, definition: definition(), runtimePublishable: false });
const tuple = (): unknown[] => [actor, tenant, flow, 2, 5, definition()];
function setup(raw: unknown = receipt(), failure?: (sql: string) => unknown) {
 const query = vi.fn<FieldDraftV2PgClient['query']>().mockImplementation(async sql => { const error = failure?.(sql); if (error) throw error; return { rows: sql.startsWith('select ') ? [{ result: raw }] : [] }; });
 const release = vi.fn<FieldDraftV2PgClient['release']>(), connect = vi.fn().mockResolvedValue({ query, release });
 return { repository: createFieldDraftV2Repository({ connect }), query, release, connect };
}
it('rejects hostile tuple descriptors/proxies and unknown RPC before pool acquisition', async () => {
 const getter = vi.fn(() => actor), accessor = tuple(); Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
 const sparse = tuple(); delete sparse[1]; const symbol = tuple(); Object.defineProperty(symbol, Symbol('actor'), { value: actor });
 const trap = vi.fn(() => { throw Error('private trap'); }); const proxy = new Proxy(tuple(), { get: trap });
 for (const input of [accessor, sparse, symbol, proxy, Object.assign(Object.create(null), tuple()), [...tuple(), actor]]) {
  const s = setup(); await expect(s.repository.call('save_field_draft_v2', input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(s.connect).not.toHaveBeenCalled();
 }
 const s = setup(); await expect(s.repository.call('save_field_draft_v2;drop table' as never, tuple())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
 expect(s.connect).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
});
it.each([[-0, 5], [Number.MAX_SAFE_INTEGER, 5], [2, 0], [2, -0], [2, Number.MAX_SAFE_INTEGER + 1]])('rejects impossible or unsafe write revision tuple %j without database work', async (revision, parent) => {
 const s = setup(); await expect(s.repository.call('save_field_draft_v2', [actor, tenant, flow, revision, parent, definition()])).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(s.connect).not.toHaveBeenCalled();
});
it('rejects V1/authority/unsafe definitions and invalid UUID selectors before database work', async () => {
 const getter = vi.fn(() => []), bad = Object.defineProperty({ schemaVersion: 2 }, 'fields', { enumerable: true, get: getter });
 for (const def of [{ ...definition(), schemaVersion: 1 }, { ...definition(), tenantId: tenant }, bad]) {
  const s = setup(); await expect(s.repository.call('save_field_draft_v2', [actor, tenant, flow, 2, 5, def])).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(s.connect).not.toHaveBeenCalled();
 }
 const s = setup(); await expect(s.repository.call('get_field_draft_v2', ['not-uuid', tenant, flow])).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(s.connect).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
});
it.each([
 { draftRevision: 4 }, { savedParentRevision: 4 }, { currentParentRevision: 6 }, { fieldDraftVersion: 1 }, { parentAuthoringVersion: 1 },
 { stale: false }, { runtimePublishable: true }, { tenantId: tenant }, { definition: { schemaVersion: 2, fields: [] } },
])('rolls back malicious or mismatched save receipt %j before COMMIT', async patch => {
 const s = setup({ ...receipt(), ...patch }); await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
 expect(s.query.mock.calls.map(([sql]) => sql)).not.toContain('commit'); expect(s.query.mock.calls.at(-1)?.[0]).toBe('rollback'); expect(s.release).toHaveBeenCalledExactlyOnceWith(undefined);
});
it('preserves exact Unicode and prompt omission in save receipt binding', async () => {
 for (const prompt of ['Exact \u{1f30d} e\u0301', '  Exact \u{1f30d} \u00e9  ', undefined]) {
  const raw = receipt(); if (prompt === undefined) delete (raw.definition.fields[0] as { prompt?: string }).prompt; else raw.definition.fields[0]!.prompt = prompt;
  const s = setup(raw); await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(s.query.mock.calls.map(([sql]) => sql)).not.toContain('commit');
 }
});
it('refuses reordered otherwise identical saved fields before commit', async () => {
 const first = definition().fields[0]!, second = { ...first, key: 'other' }, raw = receipt(); raw.definition.fields = [second, first];
 const s = setup(raw); await expect(s.repository.call('save_field_draft_v2', [actor, tenant, flow, 2, 5, { schemaVersion: 2, fields: [first, second] }])).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
 expect(s.query.mock.calls.map(([sql]) => sql)).not.toContain('commit');
});
it('does not invoke raw receipt getters and requires a single result row', async () => {
 const getter = vi.fn(() => definition()), raw = Object.defineProperty(receipt(), 'definition', { enumerable: true, get: getter }); const s = setup(raw);
 await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(getter).not.toHaveBeenCalled();
 for (const rows of [[], [{ result: receipt() }, { result: receipt() }]]) {
  const r = setup(); r.query.mockImplementation(async sql => ({ rows: sql.startsWith('select ') ? rows : [] }));
  await expect(r.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(r.query.mock.calls.at(-1)?.[0]).toBe('rollback');
 }
});
it.each([
 ['23514', 'FIELD_DRAFT_FAMILY_CONFLICT', 'CONFLICT'], ['23514', 'unknown constraint', 'INTERNAL_ERROR'],
 ['40001', 'unknown serialization', 'INTERNAL_ERROR'], ['42501', 'FORBIDDEN', 'FORBIDDEN'], ['42501', 'private SQL message', 'INTERNAL_ERROR'],
])('maps only exact finite driver error pair %s/%s', async (code, message, expected) => {
 const s = setup(receipt(), sql => sql.startsWith('select ') ? { code, message } : undefined);
 await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: expected }); expect(s.release).toHaveBeenCalledOnce();
});
it('treats forged accessor/proxy error fields as internal without exposing them', async () => {
 const getter = vi.fn(() => 'FORBIDDEN'), error = Object.defineProperty({ code: '42501' }, 'message', { enumerable: true, get: getter });
 const s = setup(receipt(), sql => sql.startsWith('select ') ? error : undefined); await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(getter).not.toHaveBeenCalled();
 const trap = vi.fn(() => { throw Error('private'); }), p = setup(receipt(), sql => sql.startsWith('select ') ? new Proxy({}, { getOwnPropertyDescriptor: trap }) : undefined);
 await expect(p.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(trap).not.toHaveBeenCalled();
});
it.each(['begin', 'set local role service_role', 'commit'])('transaction phase %s failure is bounded and releases once', async phase => {
 const s = setup(receipt(), sql => sql === phase ? { code: '42501', message: 'FORBIDDEN' } : undefined);
 await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: phase === 'commit' ? 'INTERNAL_ERROR' : 'FORBIDDEN' });
 expect(s.query.mock.calls.filter(([sql]) => sql.startsWith('select '))).toHaveLength(phase === 'commit' ? 1 : 0);
 expect(s.query.mock.calls.filter(([sql]) => sql === 'commit')).toHaveLength(phase === 'commit' ? 1 : 0); expect(s.release).toHaveBeenCalledOnce();
 if (phase === 'commit') expect(s.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
});
it('rollback failure discards connection and release errors are never retried', async () => {
 const s = setup(null, sql => sql === 'rollback' ? Error('private rollback') : undefined); s.release.mockImplementation(() => { throw Error('private release'); });
 await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(s.release).toHaveBeenCalledOnce(); expect(s.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
});
it('copies request authority and definition before awaiting pool acquisition', async () => {
 const s = setup(); let connect!: (client: FieldDraftV2PgClient) => void; s.connect.mockImplementationOnce(() => new Promise(resolve => { connect = resolve; }));
 const input = tuple(), original = definition(), operation = s.repository.call('save_field_draft_v2', input); input[0] = flow; (input[5] as ReturnType<typeof definition>).fields[0]!.prompt = 'Changed after admission';
 connect({ query: s.query, release: s.release }); await operation;
 const sent = s.query.mock.calls.find(([sql]) => sql.startsWith('select '))?.[1];
 expect(sent?.slice(0, 5)).toEqual([actor, tenant, flow, 2, 5]); expect(JSON.parse(sent?.[5] as string)).toEqual(original);
});
it('rejects driver wrapper getters without invoking them', async () => {
 const getter = vi.fn(() => [{ result: receipt() }]); const s = setup();
 s.query.mockImplementation(async sql => sql.startsWith('select ') ? Object.defineProperty({}, 'rows', { enumerable: true, get: getter }) as { rows: Record<string, unknown>[] } : { rows: [] });
 await expect(s.repository.call('save_field_draft_v2', tuple())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); expect(getter).not.toHaveBeenCalled(); expect(s.query.mock.calls.at(-1)?.[0]).toBe('rollback');
});
