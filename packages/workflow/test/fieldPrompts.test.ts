import { describe, expect, it } from 'vitest';
import { parseTextFieldDocument } from '../src/fieldAnswers';
const field = () => ({ key: 'notes', kind: 'text', required: false, minLength: 0, maxLength: 100 });
const parse = (value: unknown) => parseTextFieldDocument({ schemaVersion: 1, fields: [value] });
const withPrompt = (prompt: unknown) => parse({ ...field(), prompt });
describe('optional exact question prompts', () => {
  it('preserves omission, original content and frozen snapshots', () => {
    expect(parse(field()).fields[0]).not.toHaveProperty('prompt');
    for (const prompt of [' Question? ', '<b>Plain text</b>', '\u0085', '\u200b', 'e\u0301', '\u00e9']) {
      const input = { ...field(), prompt };
      const result = parse(input); input.prompt = 'changed';
      expect(result.fields[0]?.prompt).toBe(prompt);
      expect(Object.isFrozen(result.fields[0])).toBe(true);
    }
  });
  it('counts codepoints rather than graphemes or UTF16 units', () => {
    for (const prompt of ['a'.repeat(200), '\u{1f600}'.repeat(200), 'e\u0301'.repeat(100)]) expect(withPrompt(prompt).fields[0]?.prompt).toBe(prompt);
    for (const prompt of ['a'.repeat(201), '\u{1f600}'.repeat(201), 'e\u0301'.repeat(100)+'x']) expect(() => withPrompt(prompt)).toThrow('INVALID_TEXT_CONTRACT');
  });
  it('uses exact ECMAScript whitespace and rejects malformed/single-line violations', () => {
    const whitespace = [9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279];
    for (const code of whitespace) expect(() => withPrompt(String.fromCodePoint(code))).toThrow('INVALID_TEXT_CONTRACT');
    for (const prompt of ['', null, undefined, 1, false, {}, 'x\0y', '\ud800', '\udfff', 'a\nb','a\rb','a\u2028b','a\u2029b']) expect(() => withPrompt(prompt)).toThrow('INVALID_TEXT_CONTRACT');
  });
  it('rejects hostile descriptors, extra properties and inherited prompts without invoking getters', () => {
    let calls = 0;
    for (const descriptor of [{ get: () => { calls++; return 'Question'; }, enumerable: true }, { value: 'Question', enumerable: false }]) {
      const value = Object.defineProperty(field(), 'prompt', descriptor);
      expect(() => parse(value)).toThrow('INVALID_TEXT_CONTRACT');
    }
    expect(calls).toBe(0);
    expect(() => parse(Object.assign(Object.create({prompt:'Inherited'}),field()))).toThrow('INVALID_TEXT_CONTRACT');
    expect(() => parse({...field(),prompt:'Question',extra:true})).toThrow('INVALID_TEXT_CONTRACT');
    expect(() => parse({...field(),prompt:'Question',required:true,maxLength:0})).toThrow('INVALID_TEXT_CONTRACT');
    expect(() => parseTextFieldDocument({schemaVersion:1,fields:Array.from({length:65},(_,i)=>({...field(),key:`n${i}`,prompt:'Question'}))})).toThrow('INVALID_TEXT_CONTRACT');
  });
});
