import { expect, it, vi } from 'vitest';
import { parseFieldDraftSaveV3 as save, parseFieldDraftReceiptV3 as receipt, parseFieldDraftReadV3 as read } from '../src/fieldDraftV3';
const definition = () => ({ schemaVersion: 3, fields: [{ key: 'service', kind: 'dropdown', required: true, prompt: '  Choose 🌍  ', choices: [{ id: 'first', label: '  Exact e\u0301 🌍  ' }] }] });
const request = () => ({ fieldDraftVersion: 3, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition: definition() });
const raw = () => ({ fieldDraftVersion: 3, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 1, definition: definition(), runtimePublishable: false });
const missing = () => ({ status: 'missing', fieldDraftVersion: 3, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false });
const reject = (fn: () => unknown) => expect(fn).toThrow(/^INVALID_FIELD_DRAFT_V3_CONTRACT$/);

it('accepts version-three dropdown envelopes and derives stale from ordered parent revisions', () => {
 expect(save(request())).toEqual(request());
 expect(receipt(raw())).toEqual({ ...raw(), stale: false });
 expect(read({ status: 'present', receipt: { ...raw(), currentParentRevision: 2 } })).toEqual({ status: 'present', receipt: { ...raw(), currentParentRevision: 2, stale: true } });
 expect(read(missing())).toEqual(missing());
 reject(() => receipt({ ...raw(), savedParentRevision: 2 }));
 for (const stale of [false, true, undefined]) {
  reject(() => receipt({ ...raw(), stale }));
  reject(() => read({ status: 'present', receipt: { ...raw(), stale } }));
 }
 reject(() => receipt(receipt(raw())));
});
it.each([-0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects unsafe revision %s in every position', value => {
 for (const key of ['expectedRevision', 'expectedFlowRevision']) reject(() => save({ ...request(), [key]: value }));
 for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) reject(() => receipt({ ...raw(), [key]: value }));
 reject(() => read({ ...missing(), currentParentRevision: value }));
});
it('preserves maximum safe revisions without incrementing and permits zero only for create', () => {
 const max = Number.MAX_SAFE_INTEGER;
 expect(save({ ...request(), expectedRevision: max, expectedFlowRevision: max }).expectedRevision).toBe(max);
 expect(receipt({ ...raw(), draftRevision: max, savedParentRevision: max, currentParentRevision: max }).stale).toBe(false);
 expect(read({ ...missing(), currentParentRevision: max }).status).toBe('missing');
 expect(save(request()).expectedRevision).toBe(0);
 reject(() => save({ ...request(), expectedFlowRevision: 0 }));
 for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) reject(() => receipt({ ...raw(), [key]: 0 }));
 reject(() => read({ ...missing(), currentParentRevision: 0 }));
});
it('rejects cross-version definitions, aliases, authority and publication claims', () => {
 for (const fieldDraftVersion of [1, 2, '3', 4]) {
  reject(() => save({ ...request(), fieldDraftVersion }));
  reject(() => receipt({ ...raw(), fieldDraftVersion }));
  reject(() => read({ ...missing(), fieldDraftVersion }));
 }
 for (const parentAuthoringVersion of [1, 3, '2']) reject(() => save({ ...request(), parentAuthoringVersion }));
 for (const schemaVersion of [1, 2, '3']) reject(() => save({ ...request(), definition: { ...definition(), schemaVersion } }));
 for (const key of ['tenantId', 'actorId', 'answers', 'publishedVersionId', 'stale', 'textDraftVersion']) {
  reject(() => save({ ...request(), [key]: false }));
  reject(() => receipt({ ...raw(), [key]: false }));
  reject(() => read({ ...missing(), [key]: false }));
  reject(() => read({ status: 'present', receipt: raw(), [key]: false }));
 }
 for (const runtimePublishable of [true, undefined, 0, 'false']) {
  reject(() => receipt({ ...raw(), runtimePublishable }));
  reject(() => read({ ...missing(), runtimePublishable }));
 }
});
it('requires exact variants and all required keys', () => {
 for (const [parse, value] of [[save, request()], [receipt, raw()], [read, missing()], [read, { status: 'present', receipt: raw() }]] as const) {
  for (const key of Object.keys(value)) { const copy: Record<string, unknown> = { ...value }; delete copy[key]; reject(() => parse(copy)); }
 }
 for (const extra of [{ definition: definition() }, { receipt: raw() }, { draftRevision: 0 }, { savedParentRevision: 1 }]) reject(() => read({ ...missing(), ...extra }));
 for (const value of [{ status: 'unknown', receipt: raw() }, { ...missing(), status: 'present' }, { status: 'present', receipt: raw(), currentParentRevision: 1 }]) reject(() => read(value));
});
it('rejects hostile descriptors without calling getters and maps proxy failures to finite errors', () => {
 const getter = vi.fn(() => { throw Error('private data'); });
 reject(() => save(Object.defineProperty(request(), 'definition', { get: getter, enumerable: true })));
 reject(() => read(Object.defineProperty({ receipt: raw() }, 'status', { get: getter, enumerable: true })));
 const choice = Object.defineProperty({ id: 'first' }, 'label', { get: getter, enumerable: true });
 reject(() => receipt({ ...raw(), definition: { schemaVersion: 3, fields: [{ ...definition().fields[0], choices: [choice] }] } }));
 expect(getter).not.toHaveBeenCalled();
 for (const [parse, value] of [[save, request()], [receipt, raw()], [read, missing()]] as const) {
  reject(() => parse({ ...value, [Symbol('secret')]: true }));
  reject(() => parse(Object.assign(Object.create({ actor: 'other' }), value)));
  reject(() => parse(Object.defineProperty({ ...value }, 'fieldDraftVersion', { enumerable: false })));
  reject(() => parse(new Proxy({}, { ownKeys() { throw Error('private'); } })));
 }
});
it('detaches and freezes every dropdown level while preserving exact labels and omitted prompts', () => {
 const input = raw(); const output = read({ status: 'present', receipt: input });
 if (output.status !== 'present') throw Error('wrong variant');
 const field = output.receipt.definition.fields[0]!;
 if (field.kind !== 'dropdown') throw Error('wrong field');
 input.definition.fields[0]!.choices[0]!.label = 'changed';
 input.definition.fields[0]!.prompt = 'changed';
 expect(field.choices[0]!.label).toBe('  Exact e\u0301 🌍  ');
 expect(field.prompt).toBe('  Choose 🌍  ');
 for (const value of [output, output.receipt, output.receipt.definition, output.receipt.definition.fields, field, field.choices, field.choices[0]]) expect(Object.isFrozen(value)).toBe(true);
 const { prompt: _, ...unlabelled } = definition().fields[0]!;
 const parsed = save({ ...request(), definition: { schemaVersion: 3, fields: [unlabelled] } });
 expect(Object.hasOwn(parsed.definition.fields[0]!, 'prompt')).toBe(false);
 expect(Object.isFrozen(parsed)).toBe(true);
 expect(Object.isFrozen(read(missing()))).toBe(true);
});
it('captures changing read status descriptors once before variant selection', () => {
 let reads = 0;
 const input = new Proxy({ status: 'present', receipt: raw() }, { getOwnPropertyDescriptor(target, key) {
  if (key === 'status') return { configurable: true, enumerable: true, writable: true, value: ++reads === 1 ? 'present' : 'missing' };
  return Reflect.getOwnPropertyDescriptor(target, key);
 } });
 expect(read(input).status).toBe('present'); expect(reads).toBe(1);
});
it('captures save revision and receipt definition descriptors once', () => {
 let revisions = 0; let definitions = 0;
 const input = new Proxy(request(), { getOwnPropertyDescriptor(target, key) {
  if (key === 'expectedRevision') return { configurable: true, enumerable: true, writable: true, value: ++revisions === 1 ? 0 : -1 };
  return Reflect.getOwnPropertyDescriptor(target, key);
 } });
 expect(save(input).expectedRevision).toBe(0); expect(revisions).toBe(1);
 const response = new Proxy(raw(), { getOwnPropertyDescriptor(target, key) {
  if (key === 'definition') return { configurable: true, enumerable: true, writable: true, value: ++definitions === 1 ? definition() : { schemaVersion: 2, fields: [] } };
  return Reflect.getOwnPropertyDescriptor(target, key);
 } });
 expect(receipt(response).definition.schemaVersion).toBe(3); expect(definitions).toBe(1);
});
it('propagates nested choice invalidity without accepting sparse arrays or executable metadata', () => {
 for (const choices of [[], new Array(1), [{ id: 'first', label: 'A' }, { id: 'first', label: 'B' }], [{ id: 'first', label: 'bad\nlabel' }], [{ id: 'first', label: 'OK', price: 20 }]]) {
  const invalid = { schemaVersion: 3, fields: [{ ...definition().fields[0], choices }] };
  reject(() => save({ ...request(), definition: invalid }));
  reject(() => receipt({ ...raw(), definition: invalid }));
 }
});
