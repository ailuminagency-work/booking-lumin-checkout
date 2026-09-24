import { expect, it, vi } from 'vitest';
import { parseFieldDraftSaveV2, parseFieldDraftReceiptV2, parseFieldDraftReadV2 } from '../src/fieldDraftV2';
const definition = () => ({ schemaVersion: 2, fields: [{ key: 'notes', kind: 'textarea', prompt: 'Exact prompt', required: false, minLength: 0, maxLength: 4096 }] });
const save = () => ({ fieldDraftVersion: 2, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition: definition() });
const receipt = () => ({ fieldDraftVersion: 2, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 1, definition: definition(), runtimePublishable: false });
const missing = () => ({ status: 'missing', fieldDraftVersion: 2, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false });
const rejects = (run: () => unknown) => expect(run).toThrow(/^INVALID_FIELD_DRAFT_V2_CONTRACT$/);

it.each(['tenantId', 'actorId', 'userId', 'paymentStatus', 'answers', 'publishedVersionId', 'stale'])('rejects forged authority or unrecognized %s on every envelope', key => {
 rejects(() => parseFieldDraftSaveV2({ ...save(), [key]: false }));
 rejects(() => parseFieldDraftReceiptV2({ ...receipt(), [key]: false }));
 rejects(() => parseFieldDraftReadV2({ ...missing(), [key]: false }));
 rejects(() => parseFieldDraftReadV2({ status: 'present', receipt: receipt(), [key]: false }));
});
it.each([-0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects unsafe revision token %s in all positions', value => {
 for (const key of ['expectedRevision', 'expectedFlowRevision']) rejects(() => parseFieldDraftSaveV2({ ...save(), [key]: value }));
 for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) rejects(() => parseFieldDraftReceiptV2({ ...receipt(), [key]: value }));
 rejects(() => parseFieldDraftReadV2({ ...missing(), currentParentRevision: value }));
});
it('accepts MAX_SAFE without arithmetic while only save revision permits zero', () => {
 const maximum = Number.MAX_SAFE_INTEGER;
 expect(parseFieldDraftSaveV2({ ...save(), expectedRevision: maximum, expectedFlowRevision: maximum }).expectedRevision).toBe(maximum);
 expect(parseFieldDraftReceiptV2({ ...receipt(), draftRevision: maximum, savedParentRevision: maximum, currentParentRevision: maximum }).stale).toBe(false);
 expect(parseFieldDraftReadV2({ ...missing(), currentParentRevision: maximum }).status).toBe('missing');
 expect(parseFieldDraftSaveV2(save()).expectedRevision).toBe(0);
 rejects(() => parseFieldDraftSaveV2({ ...save(), expectedFlowRevision: 0 }));
 for (const key of ['draftRevision', 'savedParentRevision', 'currentParentRevision']) rejects(() => parseFieldDraftReceiptV2({ ...receipt(), [key]: 0 }));
});
it('derives stale only from ordered parent revisions and rejects raw stale even when correct', () => {
 expect(parseFieldDraftReceiptV2({ ...receipt(), currentParentRevision: 2 }).stale).toBe(true);
 rejects(() => parseFieldDraftReceiptV2({ ...receipt(), savedParentRevision: 2 }));
 for (const stale of [false, true, undefined]) rejects(() => parseFieldDraftReceiptV2({ ...receipt(), stale }));
 const derived = parseFieldDraftReceiptV2(receipt()); rejects(() => parseFieldDraftReceiptV2(derived));
 rejects(() => parseFieldDraftReadV2({ status: 'present', receipt: derived }));
});
it('rejects mixed versions, aliases and publication capability claims', () => {
 for (const fieldDraftVersion of [1, '2', 3]) rejects(() => parseFieldDraftSaveV2({ ...save(), fieldDraftVersion }));
 for (const parentAuthoringVersion of [1, '2', 3]) rejects(() => parseFieldDraftReceiptV2({ ...receipt(), parentAuthoringVersion }));
 rejects(() => parseFieldDraftSaveV2({ ...save(), definition: { ...definition(), schemaVersion: 1 } }));
 const { fieldDraftVersion: _, ...rest } = save(); rejects(() => parseFieldDraftSaveV2({ ...rest, textDraftVersion: 1 }));
 for (const runtimePublishable of [true, 0, 'false', undefined]) {
  rejects(() => parseFieldDraftReceiptV2({ ...receipt(), runtimePublishable }));
  rejects(() => parseFieldDraftReadV2({ ...missing(), runtimePublishable }));
 }
});
it('requires exact present/missing read variants without inferred payloads', () => {
 expect(parseFieldDraftReadV2({ status: 'present', receipt: receipt() }).status).toBe('present');
 for (const addition of [{ definition: definition() }, { draftRevision: 0 }, { savedParentRevision: 1 }, { receipt: receipt() }]) rejects(() => parseFieldDraftReadV2({ ...missing(), ...addition }));
 for (const input of [{ status: 'present' }, { status: 'unknown', receipt: receipt() }, { ...missing(), status: 'present' }, { receipt: receipt() }]) rejects(() => parseFieldDraftReadV2(input));
});
it('rejects accessor envelopes and nested fields without invoking user getters', () => {
 const getter = vi.fn(() => { throw Error('private payload'); });
 const input = Object.defineProperty(save(), 'definition', { enumerable: true, get: getter }); rejects(() => parseFieldDraftSaveV2(input));
 const read = Object.defineProperty({ receipt: receipt() }, 'status', { enumerable: true, get: getter }); rejects(() => parseFieldDraftReadV2(read));
 const field = Object.defineProperty(definition().fields[0]!, 'prompt', { enumerable: true, get: getter });
 rejects(() => parseFieldDraftReceiptV2({ ...receipt(), definition: { schemaVersion: 2, fields: [field] } }));
 expect(getter).not.toHaveBeenCalled();
});
it('rejects symbols, nonenumerable fields, prototype authority and throwing proxies with finite errors', () => {
 const symbol = { ...save(), [Symbol('authority')]: true }; rejects(() => parseFieldDraftSaveV2(symbol));
 const hidden = Object.defineProperty(receipt(), 'runtimePublishable', { value: false, enumerable: false }); rejects(() => parseFieldDraftReceiptV2(hidden));
 rejects(() => parseFieldDraftReadV2(Object.assign(Object.create({ actor: 'other' }), missing())));
 for (const parse of [parseFieldDraftSaveV2, parseFieldDraftReceiptV2, parseFieldDraftReadV2]) {
  rejects(() => parse(new Proxy({}, { getPrototypeOf() { throw Error('secret'); } })));
  rejects(() => parse(new Proxy({}, { ownKeys() { throw Error('secret'); } })));
 }
});
it('enforces nested definition limits, density and prompt Unicode rules', () => {
 const base = definition().fields[0]!;
 const fields = Array.from({ length: 64 }, (_, i) => ({ ...base, key: 'q' + i }));
 expect(parseFieldDraftSaveV2({ ...save(), definition: { schemaVersion: 2, fields } }).definition.fields).toHaveLength(64);
 for (const unsafe of [new Array(1), [...fields, { ...base, key: 'extra' }], [base, base], [{ ...base, maxLength: 4097 }], [{ ...base, prompt: '\u{1f30d}'.repeat(201) }], [{ ...base, prompt: 'x\ny' }], [{ ...base, prompt: '\0' }], [{ ...base, prompt: '\ud800' }]]) {
  rejects(() => parseFieldDraftSaveV2({ ...save(), definition: { schemaVersion: 2, fields: unsafe } }));
  rejects(() => parseFieldDraftReceiptV2({ ...receipt(), definition: { schemaVersion: 2, fields: unsafe } }));
 }
});
it('returns deeply frozen detached snapshots preserving exact metadata and omission', () => {
 const raw = receipt(); raw.definition.fields[0]!.prompt = '  Exact \u{1f30d} e\u0301  ';
 const parsed = parseFieldDraftReadV2({ status: 'present', receipt: raw }); expect(parsed.status).toBe('present');
 if (parsed.status !== 'present') throw Error('unexpected variant');
 expect(parsed.receipt.definition.fields[0]?.prompt).toBe('  Exact \u{1f30d} e\u0301  ');
 raw.definition.fields[0]!.prompt = 'changed'; expect(parsed.receipt.definition.fields[0]?.prompt).not.toBe('changed');
 for (const value of [parsed, parsed.receipt, parsed.receipt.definition, parsed.receipt.definition.fields, parsed.receipt.definition.fields[0]]) expect(Object.isFrozen(value)).toBe(true);
 const omitted = { ...definition().fields[0]! }; delete (omitted as { prompt?: string }).prompt;
 const result = parseFieldDraftSaveV2({ ...save(), definition: { schemaVersion: 2, fields: [omitted] } });
 expect(Object.hasOwn(result.definition.fields[0]!, 'prompt')).toBe(false); expect(Object.isFrozen(result)).toBe(true);
 expect(Object.isFrozen(parseFieldDraftReadV2(missing()))).toBe(true);
});
