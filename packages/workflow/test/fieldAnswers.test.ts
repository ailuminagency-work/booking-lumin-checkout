import { describe, expect, it } from 'vitest';
import { parseTextAnswers, parseTextFieldDocument } from '../src/fieldAnswers';
const field = (extra = {}) => ({ key: 'instructions', kind: 'text', required: true, minLength: 1, maxLength: 4096, ...extra });
const document = (fields: unknown[] = [field()]) => ({ schemaVersion: 1, fields });
const answers = (value: unknown) => ({ schemaVersion: 1, answers: [{ key: 'instructions', value }] });
const invalid = (run: () => unknown) => expect(run).toThrow('INVALID_TEXT_CONTRACT');
describe('isolated text contract', () => {
  it('preserves text, combining sequences, leading zeros and inert markup exactly', () => {
    for (const text of [' 001 ', 'e\u0301', '\u00e9', '😀', '<script>not executable</script>']) {
      expect(parseTextAnswers(document(), answers(text)).answers[0]?.value).toBe(text);
    }
    expect(parseTextAnswers(document([field({ maxLength: 1 })]), answers('😀')).answers[0]?.value).toBe('😀');
    invalid(() => parseTextAnswers(document([field({ maxLength: 1 })]), answers('e\u0301')));
  });
  it('bounds code points and rejects malformed UTF-16 and line separators', () => {
    expect(parseTextAnswers(document(), answers('😀'.repeat(4096))).answers[0]?.value.length).toBe(8192);
    for (const value of ['a'.repeat(4097), '😀'.repeat(4097), '\ud800', '\udfff', 'x\ny', 'x\ry', '\u2028', '\u2029', 42, null]) invalid(() => parseTextAnswers(document(), answers(value)));
  });
  it('defines required, omitted and optional whitespace without normalization', () => {
    for (const value of ['', ' ', '\t', '\u00a0']) invalid(() => parseTextAnswers(document([field({ minLength: 0 })]), answers(value)));
    invalid(() => parseTextAnswers(document(), { schemaVersion: 1, answers: [] }));
    const optional = document([field({ required: false, minLength: 3, maxLength: 5 })]);
    for (const value of ['', ' ', '\t']) expect(parseTextAnswers(optional, answers(value)).answers[0]?.value).toBe(value);
    expect(parseTextAnswers(optional, { schemaVersion: 1, answers: [] }).answers).toEqual([]);
    invalid(() => parseTextAnswers(optional, answers('a')));
    invalid(() => parseTextAnswers(optional, answers(' '.repeat(6))));
  });
  it('rejects unsatisfiable required zero-length fields but permits optional empty values', () => {
    invalid(() => parseTextFieldDocument(document([field({ required: true, minLength: 0, maxLength: 0 })])));
    const optional = document([field({ required: false, minLength: 0, maxLength: 0 })]);
    expect(parseTextAnswers(optional, answers('')).answers[0]?.value).toBe('');
    expect(parseTextAnswers(optional, { schemaVersion: 1, answers: [] }).answers).toEqual([]);
    invalid(() => parseTextAnswers(optional, answers(' ')));
    invalid(() => parseTextAnswers(optional, answers('x')));
  });
  it('rejects versions, kinds, bounds, unknown properties and duplicate/unsafe keys', () => {
    for (const extra of [{ kind: 'textarea' }, { required: 1 }, { minLength: -1 }, { maxLength: 4097 }, { minLength: 4, maxLength: 3 }, { maxLength: NaN }, { minLength: 0.5 }, { key: 'a'.repeat(65) }, { key: 'constructor' }, { key: 'prototype' }, { key: '__proto__' }, { authority: 'tenant' }]) invalid(() => parseTextFieldDocument(document([field(extra)])));
    invalid(() => parseTextFieldDocument({ ...document(), schemaVersion: 2 }));
    invalid(() => parseTextAnswers(document(), { ...answers('x'), schemaVersion: 2 }));
    invalid(() => parseTextAnswers(document(), { ...answers('x'), tenantId: 'tenant' }));
    invalid(() => parseTextFieldDocument(document([field(), field()])));
    invalid(() => parseTextAnswers(document(), { schemaVersion: 1, answers: [{ key: 'unknown', value: 'x' }] }));
    invalid(() => parseTextAnswers(document(), { schemaVersion: 1, answers: [{ key: 'instructions', value: 'x' }, { key: 'instructions', value: 'y' }] }));
  });
  it('rejects getters, inherited/symbol/hidden properties, sparse and oversized arrays', () => {
    let reads = 0;
    const getter = Object.defineProperty(field(), 'key', { get() { reads++; throw new Error('unsafe'); }, enumerable: true });
    invalid(() => parseTextFieldDocument(document([getter])));
    const item = Object.defineProperty({}, '0', { get() { reads++; return field(); }, enumerable: true });
    const array = [field()]; Object.defineProperty(array, '0', Object.getOwnPropertyDescriptor(item, '0')!);
    invalid(() => parseTextFieldDocument(document(array)));
    const valueGetter = Object.defineProperty({ key: 'instructions' }, 'value', { get() { reads++; return 'x'; }, enumerable: true });
    invalid(() => parseTextAnswers(document(), { schemaVersion: 1, answers: [valueGetter] }));
    expect(reads).toBe(0);
    invalid(() => parseTextFieldDocument(document([Object.assign(Object.create({ inherited: true }), field())])));
    invalid(() => parseTextFieldDocument(document([Object.assign(field(), { [Symbol('extra')]: 1 })])));
    invalid(() => parseTextFieldDocument(document([Object.defineProperty(field(), 'hidden', { value: 1 })])));
    invalid(() => parseTextFieldDocument(document(new Array(1))));
    invalid(() => parseTextFieldDocument(document(Array.from({ length: 65 }, (_, i) => field({ key: `f${i}` })))));
    expect(parseTextFieldDocument(document(Array.from({ length: 64 }, (_, i) => field({ key: `f${i}` })))).fields).toHaveLength(64);
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); invalid(() => parseTextFieldDocument(revoked.proxy));
    expect(parseTextFieldDocument(Object.assign(Object.create(null), document())).fields).toHaveLength(1);
  });
  it('copies deeply, freezes every result node, and preserves supplied answer order', () => {
    const input = document([field(), field({ key: 'other', required: false })]);
    const parsed = parseTextFieldDocument(input);
    const raw = { schemaVersion: 1, answers: [{ key: 'other', value: 'second' }, { key: 'instructions', value: 'first' }] };
    const result = parseTextAnswers(input, raw);
    input.fields[0] = field({ key: 'changed' }); raw.answers[0]!.value = 'changed';
    expect(parsed.fields[0]?.key).toBe('instructions'); expect(result.answers[0]?.value).toBe('second');
    for (const value of [parsed, parsed.fields, ...parsed.fields, result, result.answers, ...result.answers]) expect(Object.isFrozen(value)).toBe(true);
  });
});
