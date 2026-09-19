import { describe, expect, it, vi } from 'vitest';
import { createFieldDraftV3Repository, type FieldDraftV3PgClient } from './field-drafts-v3-repository';
const actor = '11111111-1111-4111-8111-111111111111', tenant = '22222222-2222-4222-8222-222222222222', flow = '33333333-3333-4333-8333-333333333333';
const definition = { schemaVersion: 3, fields: [{ key: 'service', kind: 'dropdown', required: true, choices: [{ id: 'one', label: ' Same ' }, { id: 'two', label: ' Same ' }] }] };
const receipt = { fieldDraftVersion: 3, parentAuthoringVersion: 2, draftRevision: 3, savedParentRevision: 5, currentParentRevision: 5, definition, runtimePublishable: false };
const missing = { status: 'missing', fieldDraftVersion: 3, parentAuthoringVersion: 2, currentParentRevision: 5, runtimePublishable: false };
const save = () => [actor, tenant, flow, 2, 5, definition];
function setup(value: unknown = receipt, fail?: (sql: string) => unknown) {
  const query = vi.fn<FieldDraftV3PgClient['query']>().mockImplementation(async sql => {
    const error = fail?.(sql); if (error) throw error;
    return { rows: sql.startsWith('select ') ? [{ result: value }] : [] };
  });
  const release = vi.fn<FieldDraftV3PgClient['release']>();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { repo: createFieldDraftV3Repository({ connect }), query, release, connect };
}
describe('V3 draft PostgreSQL repository', () => {
  it('binds actor/tenant/flow and save CAS to fixed parameterized SQL before commit', async () => {
    const { repo, query, release } = setup();
    expect(await repo.call('save_field_draft_v3', save())).toEqual(receipt);
    expect(query.mock.calls).toEqual([
      ['begin'], ['set local role service_role'],
      ['select public.save_field_draft_v3($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bigint,$6::jsonb) as result', [actor, tenant, flow, 2, 5, JSON.stringify(definition)]], ['commit'],
    ]);
    expect(release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it.each([missing, { status: 'present', receipt: { ...receipt, currentParentRevision: 6 } }])('validates raw read and never adds stale on the wire', async raw => {
    const { repo, query } = setup(raw);
    expect(await repo.call('get_field_draft_v3', [actor, tenant, flow])).toEqual(raw);
    expect(query.mock.calls[2]).toEqual(['select public.get_field_draft_v3($1::uuid,$2::uuid,$3::uuid) as result', [actor, tenant, flow]]);
    expect(query.mock.calls.at(-1)).toEqual(['commit']);
  });
  it.each([
    { ...receipt, draftRevision: 4 }, { ...receipt, savedParentRevision: 4 },
    { ...receipt, currentParentRevision: 6 }, { ...receipt, definition: { schemaVersion: 3, fields: [] } },
    { ...receipt, stale: false }, { ...receipt, runtimePublishable: true }, null,
  ])('rolls back malformed or mismatched save receipt before commit', async raw => {
    const { repo, query, release } = setup(raw);
    await expect(repo.call('save_field_draft_v3', save())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(query.mock.calls.map(call => call[0])).toEqual(['begin', 'set local role service_role', expect.stringContaining('select '), 'rollback']);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejects multiple rows and malformed read receipt before commit', async () => {
    const first = setup({ ...missing, tenantId: tenant });
    await expect(first.repo.call('get_field_draft_v3', [actor, tenant, flow])).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const second = setup();
    second.query.mockImplementation(async sql => ({ rows: sql.startsWith('select ') ? [{ result: receipt }, { result: receipt }] : [] }));
    await expect(second.repo.call('save_field_draft_v3', save())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(second.query.mock.calls.at(-1)).toEqual(['rollback']);
  });
  it.each([
    ['42501', 'FORBIDDEN', 'FORBIDDEN'], ['40001', 'FIELD_DRAFT_V3_PARENT_CONFLICT', 'CONFLICT'],
    ['40001', 'FIELD_DRAFT_V3_REVISION_CONFLICT', 'CONFLICT'], ['P0002', 'FIELD_DRAFT_V3_NOT_AVAILABLE', 'NOT_AVAILABLE'],
    ['0A000', 'FIELD_DRAFT_V3_UNSUPPORTED_PARENT', 'UNSUPPORTED_CONFIG'], ['22023', 'FIELD_DRAFT_V3_INVALID', 'INVALID_REQUEST'],
    ['23514', 'FIELD_DRAFT_FAMILY_CONFLICT', 'CONFLICT'],
    ['23514', 'FIELD_DRAFT_V3_PARENT_HISTORY', 'INTERNAL_ERROR'], ['40001', 'secret driver error', 'INTERNAL_ERROR'],
  ])('maps exact database failure %s/%s to %s without driver text', async (code, message, expected) => {
    const { repo, query, release } = setup(receipt, sql => sql.startsWith('select ') ? Object.assign(new Error(message), { code }) : undefined);
    const error = await repo.call('save_field_draft_v3', save()).catch(error => error);
    expect(error).toMatchObject({ code: expected, message: expected });
    expect(query.mock.calls.at(-1)).toEqual(['rollback']); expect(release).toHaveBeenCalledOnce();
  });
  it('rejects invalid tuple before acquiring a connection', async () => {
    const { repo, connect } = setup();
    for (const params of [[actor, tenant], [actor, tenant, '../flow'], [...save(), 'extra'], [actor, tenant, flow, Number.MAX_SAFE_INTEGER, 5, definition]]) {
      await expect(repo.call('save_field_draft_v3', params)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    const getter = vi.fn(() => actor), tuple = [actor, tenant, flow];
    Object.defineProperty(tuple, '0', { get: getter });
    await expect(repo.call('get_field_draft_v3', tuple)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(getter).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  });
  it('captures immutable input before async connection acquisition', async () => {
    const { repo, query } = setup(); const input = save();
    const pending = repo.call('save_field_draft_v3', input); input[1] = flow; input[3] = 99;
    await pending; expect(query.mock.calls[2]?.[1]).toEqual([actor, tenant, flow, 2, 5, JSON.stringify(definition)]);
  });
  it('discards on rollback failure and ambiguous commit failure without retrying mutation', async () => {
    for (const failing of ['commit', 'rollback']) {
      const { repo, query, release } = setup(failing === 'rollback' ? null : receipt, sql => sql === failing ? new Error('private') : undefined);
      await expect(repo.call('save_field_draft_v3', save())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'FIELD_DRAFT_V3_CONNECTION_DISCARDED' }));
      expect(query.mock.calls.filter(call => call[0].startsWith('select '))).toHaveLength(1);
    }
  });
  it('sanitizes acquisition failure and does not release an unowned client', async () => {
    const { repo, connect, release } = setup(); connect.mockRejectedValue(new Error('credential private'));
    await expect(repo.call('save_field_draft_v3', save())).rejects.toMatchObject({ message: 'INTERNAL_ERROR' });
    expect(release).not.toHaveBeenCalled();
  });
});

it('does not invoke malformed driver result getters and rolls back',async()=>{
 const {repo,query}=setup();let calls=0;query.mockImplementation(async sql=>sql.startsWith('select ')?Object.defineProperty({},'rows',{get(){calls++;return [];}}) as never:{rows:[]});
 await expect(repo.call('save_field_draft_v3',save())).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(calls).toBe(0);expect(query.mock.calls.at(-1)).toEqual(['rollback']);
});
it('rejects nonstring RPC names without invoking coercion',async()=>{
 const {repo,connect}=setup();const coerce=vi.fn(()=> 'get_field_draft_v3');
 await expect(repo.call({[Symbol.toPrimitive]:coerce} as never,[actor,tenant,flow])).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(coerce).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
});
