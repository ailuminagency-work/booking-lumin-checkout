import { describe, expect, it } from 'vitest';
import { parseTextFieldDraftSave as save, parseTextFieldDraftReceipt as receipt, parseTextFieldDraftRead as read } from '../src/textFieldDraft';
const definition = () => ({ schemaVersion: 1, fields: [{ key: 'notes', kind: 'text', required: true, minLength: 1, maxLength: 100 }] });
const request = () => ({ textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition: definition() });
const stored = () => ({ textDraftVersion: 1, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 1, definition: definition(), runtimePublishable: false });
const missing = () => ({ status: 'missing', textDraftVersion: 1, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false });
const invalid = (run: () => unknown) => expect(run).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
describe('text definition draft transport', () => {
  it('preserves explicit create/update tokens without pretending to execute CAS or authorize a parent', () => {
    expect(save(request()).expectedRevision).toBe(0);
    expect(save({ ...request(), expectedRevision: 12, expectedFlowRevision: 7 })).toMatchObject({ expectedRevision: 12, expectedFlowRevision: 7, parentAuthoringVersion: 2 });
    // No database/owner exists here: accepting discriminator 2 does not prove actual parent authority.
    expect(save(request()).parentAuthoringVersion).toBe(2);
    for (const property of ['actorId', 'tenantId', 'flowId', 'authorized', 'stale']) invalid(() => save({ ...request(), [property]: 'client' }));
  });
  it('accepts safe boundary tokens but never increments or rebases them', () => {
    expect(save({ ...request(), expectedRevision: Number.MAX_SAFE_INTEGER, expectedFlowRevision: Number.MAX_SAFE_INTEGER }).expectedRevision).toBe(Number.MAX_SAFE_INTEGER);
    expect(receipt({ ...stored(), draftRevision: Number.MAX_SAFE_INTEGER, savedParentRevision: Number.MAX_SAFE_INTEGER, currentParentRevision: Number.MAX_SAFE_INTEGER }).stale).toBe(false);
    for (const value of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      invalid(() => save({ ...request(), expectedRevision: value }));
      invalid(() => save({ ...request(), expectedFlowRevision: value }));
      for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) invalid(() => receipt({ ...stored(), [key]: value }));
    }
    invalid(() => save({ ...request(), expectedFlowRevision: 0 }));
    for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) invalid(() => receipt({ ...stored(), [key]: 0 }));
  });
  it('derives staleness from monotonic parent history and refuses supplied status', () => {
    expect(receipt(stored()).stale).toBe(false);
    const raw = { ...stored(), savedParentRevision: 2, currentParentRevision: 3 };
    expect(receipt(raw)).toMatchObject({ stale: true, savedParentRevision: 2, currentParentRevision: 3 });
    expect(raw.savedParentRevision).toBe(2);
    invalid(() => receipt({ ...stored(), savedParentRevision: 2 }));
    invalid(() => receipt({ ...stored(), stale: false }));
    invalid(() => receipt({ ...stored(), runtimePublishable: true }));
  });
  it('distinguishes absent storage from an empty stored definition', () => {
    expect(read(missing())).toEqual(missing());
    for (const key of ['draftRevision', 'savedParentRevision', 'definition', 'stale']) invalid(() => read({ ...missing(), [key]: 0 }));
    const present = read({ status: 'present', receipt: { ...stored(), definition: { schemaVersion: 1, fields: [] } } });
    expect(present.status).toBe('present');
    if (present.status === 'present') expect(present.receipt.definition.fields).toEqual([]);
    invalid(() => read({ status: 'present' })); invalid(() => read({ status: 'missing' }));
    invalid(() => read({ ...missing(), currentParentRevision: 0 }));
    invalid(() => read({ ...missing(), runtimePublishable: true }));
    invalid(() => read({ status: 'unknown' }));
  });
  it('rejects unknown versions and properties and preserves definition constraints', () => {
    for (const [parse, raw] of [[save, request()], [receipt, stored()], [read, missing()]] as const) {
      invalid(() => parse({ ...raw, textDraftVersion: 2 })); invalid(() => parse({ ...raw, parentAuthoringVersion: 1 }));
      invalid(() => parse({ ...raw, extra: true }));
    }
    for (const bad of [{ schemaVersion: 2, fields: [] }, { schemaVersion: 1, fields: [{ ...definition().fields[0], kind: 'textarea' }] }, { schemaVersion: 1, fields: Array(65).fill(definition().fields[0]) }]) {
      invalid(() => save({ ...request(), definition: bad })); invalid(() => receipt({ ...stored(), definition: bad }));
    }
  });
  it('never invokes getters and rejects inherited, symbol, hidden and revoked-proxy inputs', () => {
    let accesses = 0;
    for (const [parse, raw, key] of [[save, request(), 'definition'], [receipt, stored(), 'currentParentRevision'], [read, missing(), 'status']] as const) {
      invalid(() => parse(Object.defineProperty({ ...raw }, key, { enumerable: true, get() { accesses++; return 1; } })));
      invalid(() => parse(Object.assign(Object.create({ injected: true }), raw)));
      invalid(() => parse({ ...raw, [Symbol('extra')]: true }));
      invalid(() => parse(Object.defineProperty({ ...raw }, 'extra', { value: true })));
      const revocable = Proxy.revocable({}, {}); revocable.revoke(); invalid(() => parse(revocable.proxy));
      expect(parse(Object.assign(Object.create(null), raw))).toBeDefined();
    }
    const nested = Object.defineProperty(definition(), 'fields', { enumerable: true, get() { accesses++; return []; } });
    invalid(() => save({ ...request(), definition: nested })); expect(accesses).toBe(0);
  });
  it('returns detached deeply frozen results', () => {
    const raw = request(), parsed = save(raw); raw.definition.fields[0]!.key = 'changed';
    expect(parsed.definition.fields[0]?.key).toBe('notes');
    const result = read({ status: 'present', receipt: stored() });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === 'present') for (const item of [result.receipt, result.receipt.definition, result.receipt.definition.fields, ...result.receipt.definition.fields]) expect(Object.isFrozen(item)).toBe(true);
    for (const item of [parsed, parsed.definition, parsed.definition.fields, ...parsed.definition.fields, read(missing())]) expect(Object.isFrozen(item)).toBe(true);
  });
});
