import { expect, it, vi } from 'vitest';
import { parseFieldDocumentV2 } from '../src/fieldDocumentV2';
import { parseFieldAnswersV2 } from '../src/fieldAnswersV2';
import { parseTextAnswers, parseTextFieldDocument } from '../src/fieldAnswers';
const field = (key = 'a', kind = 'text', extra = {}) => ({ key, kind, required: false, minLength: 0, maxLength: 4096, ...extra });
const doc = (...fields: unknown[]) => ({ schemaVersion: 2, fields });
const answers = (...entries: unknown[]) => ({ schemaVersion: 2, answers: entries });
const answer = (value: unknown, key = 'a') => ({ key, value });
const rejects = (run: () => unknown) => expect(run).toThrow(/^INVALID_FIELD_V2_CONTRACT$/);

it('accepts exact codepoint and UTF16 boundaries without normalizing strings', () => {
 const definition = doc(field('a', 'textarea'));
 const astral = '\u{1f30d}'.repeat(4096);
 expect(parseFieldAnswersV2(definition, answers(answer(astral))).answers[0]?.value).toBe(astral);
 rejects(() => parseFieldAnswersV2(definition, answers(answer(astral + 'x'))));
 rejects(() => parseFieldAnswersV2(definition, answers(answer('x'.repeat(4097)))));
 const exact = '  e\u0301\r\n\u2028\u2029\t ';
 expect(parseFieldAnswersV2(definition, answers(answer(exact))).answers[0]?.value).toBe(exact);
});
it.each(['\r', '\n', '\u2028', '\u2029'])('allows textarea separator %j but rejects it for text', separator => {
 const value = 'a' + separator + 'b';
 expect(parseFieldAnswersV2(doc(field('a', 'textarea')), answers(answer(value))).answers[0]?.value).toBe(value);
 rejects(() => parseFieldAnswersV2(doc(field()), answers(answer(value))));
});
it('counts CRLF as two codepoints and preserves mixed text/textarea semantics', () => {
 const definition = doc(field('a', 'textarea', { minLength: 4, maxLength: 4 }), field('b'));
 expect(parseFieldAnswersV2(definition, answers(answer('x\r\ny'), answer('single', 'b'))).answers[0]?.value).toBe('x\r\ny');
 rejects(() => parseFieldAnswersV2(doc(field('a', 'textarea', { maxLength: 3 })), answers(answer('x\r\ny'))));
 rejects(() => parseFieldAnswersV2(definition, answers(answer('x\r\ny'), answer('x\ny', 'b'))));
});
it.each(['\0', '\ud800', '\udfff', '\udc00\ud800'])('rejects NUL and malformed Unicode %j in both kinds', value => {
 for (const kind of ['text', 'textarea']) rejects(() => parseFieldAnswersV2(doc(field('a', kind)), answers(answer(value))));
});
it('accepts aggregate65536 UTF16 and rejects65537 before any normalization', () => {
 const fields = Array.from({ length: 9 }, (_, index) => field('q' + index, 'textarea'));
 const entries = Array.from({ length: 8 }, (_, index) => answer('\u{1f30d}'.repeat(4096), 'q' + index));
 expect(parseFieldAnswersV2(doc(...fields), answers(...entries)).answers).toHaveLength(8);
 rejects(() => parseFieldAnswersV2(doc(...fields), answers(...entries, answer('x', 'q8'))));
});
it('rejects version confusion while keeping existing V1 NUL behavior unchanged', () => {
 const v1 = { schemaVersion: 1, fields: [field()] };
 expect(parseTextAnswers(v1, { schemaVersion: 1, answers: [answer('\0')] }).answers[0]?.value).toBe('\0');
 rejects(() => parseFieldDocumentV2(v1)); rejects(() => parseFieldAnswersV2(doc(field()), { schemaVersion: 1, answers: [] }));
 expect(() => parseTextFieldDocument(doc(field()))).toThrow('INVALID_TEXT_CONTRACT');
 expect(() => parseTextFieldDocument({ schemaVersion: 1, fields: [field('a', 'textarea')] })).toThrow('INVALID_TEXT_CONTRACT');
});
it('preserves omitted answers but rejects duplicate, unknown and missing required answers', () => {
 expect(parseFieldAnswersV2(doc(field()), answers()).answers).toEqual([]);
 rejects(() => parseFieldAnswersV2(doc(field()), answers(answer('x'), answer('y'))));
 rejects(() => parseFieldAnswersV2(doc(field()), answers(answer('x', 'other'))));
 rejects(() => parseFieldAnswersV2(doc(field('a', 'textarea', { required: true })), answers()));
 rejects(() => parseFieldAnswersV2(doc(field('a', 'textarea', { required: true })), answers(answer(' \r\n\t'))));
});
it('strictly limits64 dense fields and answers and rejects array metadata', () => {
 const fields = Array.from({ length: 64 }, (_, index) => field('q' + index));
 const entries = fields.map(item => answer('x', item.key));
 expect(parseFieldAnswersV2(doc(...fields), answers(...entries)).answers).toHaveLength(64);
 rejects(() => parseFieldDocumentV2(doc(...fields, field('extra'))));
 const sparse = new Array(1); rejects(() => parseFieldDocumentV2({ schemaVersion: 2, fields: sparse }));
 const decorated = [field()]; Object.defineProperty(decorated, Symbol('hidden'), { value: true });
 rejects(() => parseFieldDocumentV2({ schemaVersion: 2, fields: decorated }));
 const sparseAnswers = new Array(1); rejects(() => parseFieldAnswersV2(doc(field()), { schemaVersion: 2, answers: sparseAnswers }));
});
it('rejects getters, nonenumerable authority, inherited prototypes and hostile proxy traps with finite errors', () => {
 const getter = vi.fn(() => 'secret'); const bad = Object.defineProperty(field(), 'prompt', { enumerable: true, get: getter });
 rejects(() => parseFieldDocumentV2(doc(bad))); expect(getter).not.toHaveBeenCalled();
 const badAnswer = Object.defineProperty({ key: 'a' }, 'value', { enumerable: true, get: getter });
 rejects(() => parseFieldAnswersV2(doc(field()), answers(badAnswer))); expect(getter).not.toHaveBeenCalled();
 rejects(() => parseFieldDocumentV2(Object.assign(Object.create({ inherited: true }), doc(field()))));
 const hidden = field(); Object.defineProperty(hidden, 'required', { value: false, enumerable: false }); rejects(() => parseFieldDocumentV2(doc(hidden)));
 rejects(() => parseFieldDocumentV2(new Proxy({}, { ownKeys() { throw Error('private payload'); } })));
 rejects(() => parseFieldAnswersV2(doc(field()), new Proxy({}, { getPrototypeOf() { throw Error('private payload'); } })));
});
it('returns frozen detached copies and preserves prompt omission versus exact metadata', () => {
 const original = field('a', 'textarea', { prompt: '  Prompt \u{1f30d}  ' }), input = doc(original, field('b'));
 const parsed = parseFieldDocumentV2(input); expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.fields)).toBe(true); expect(Object.isFrozen(parsed.fields[0])).toBe(true);
 expect(parsed.fields[0]).not.toBe(original); expect(parsed.fields[0]?.prompt).toBe('  Prompt \u{1f30d}  '); expect(Object.hasOwn(parsed.fields[1]!, 'prompt')).toBe(false);
 const entry = answer('original'); const result = parseFieldAnswersV2(input, answers(entry)); entry.value = 'modified';
 expect(result.answers[0]?.value).toBe('original'); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.answers)).toBe(true); expect(Object.isFrozen(result.answers[0])).toBe(true);
});
it('rejects mixed scalar types, extra authority keys and malformed prompt metadata', () => {
 for (const value of [null, 2, true, {}, new String('x')]) rejects(() => parseFieldAnswersV2(doc(field()), answers(answer(value))));
 for (const extra of [{ kind: 'number' }, { required: 'yes' }, { maxLength: 4097 }, { minLength: 2, maxLength: 1 }, { tenantId: 'injected' }, { prompt: '' }, { prompt: 'x\ny' }]) rejects(() => parseFieldDocumentV2(doc(field('a', 'textarea', extra))));
 rejects(() => parseFieldAnswersV2(doc(field()), { schemaVersion: 2, answers: [answer('x')], actorId: 'injected' }));
});
it('enforces exact key and prompt boundaries independently of textarea answer rules', () => {
 const key = 'a'.repeat(64), prompt = '\u{1f30d}'.repeat(200);
 expect(parseFieldDocumentV2(doc(field(key, 'textarea', { prompt }))).fields[0]?.prompt).toBe(prompt);
 rejects(() => parseFieldDocumentV2(doc(field(key + 'a'))));
 rejects(() => parseFieldDocumentV2(doc(field('a', 'textarea', { prompt: prompt + 'a' }))));
 for (const key of ['constructor', 'prototype', '__proto__']) rejects(() => parseFieldDocumentV2(doc(field(key))));
 for (const prompt of ['\0', '\ud800', 'x\r\ny', 'x\u2028y', 'x\u2029y']) rejects(() => parseFieldDocumentV2(doc(field('a', 'textarea', { prompt }))));
});
it('rejects answer array accessors and symbol properties without executing getters', () => {
 const getter = vi.fn(() => answer('x')), list = [answer('x')]; Object.defineProperty(list, '0', { enumerable: true, get: getter });
 rejects(() => parseFieldAnswersV2(doc(field()), { schemaVersion: 2, answers: list })); expect(getter).not.toHaveBeenCalled();
 const entry = answer('x'); Object.defineProperty(entry, Symbol('authority'), { value: true });
 rejects(() => parseFieldAnswersV2(doc(field()), answers(entry)));
});
