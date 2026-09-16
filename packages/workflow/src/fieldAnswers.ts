/** Independent non-commerce contract; not a Selection, publication or authorization API.
 * Callers must enforce raw request-byte limits before JSON decoding. Reflective proxy
 * traps cannot be avoided in JavaScript; failures reject, and getters are never read.
 */
export interface TextField { readonly key: string; readonly kind: 'text'; readonly required: boolean; readonly minLength: number; readonly maxLength: number }
export interface TextFieldDocument { readonly schemaVersion: 1; readonly fields: readonly TextField[] }
export interface TextAnswerDocument { readonly schemaVersion: 1; readonly answers: readonly Readonly<{ key: string; value: string }>[] }
const reject = (): never => { throw new Error('INVALID_TEXT_CONTRACT'); };
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object') return reject();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return reject();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return reject();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return reject();
    result[key] = descriptor.value;
  }
  return result;
}
function list(input: unknown): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return reject();
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !('value' in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > 64) return reject();
  const count: number = length.value;
  if (Reflect.ownKeys(input).length !== count + 1) return reject();
  const output: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return reject();
    output.push(descriptor.value);
  }
  return output;
}
function key(input: unknown): string {
  if (typeof input !== 'string' || input.length > 64 || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input) || ['__proto__', 'prototype', 'constructor'].includes(input)) return reject();
  return input;
}
function bound(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > 4096) return reject();
  return input;
}
function parseFields(input: unknown): TextFieldDocument {
  const document = record(input, ['schemaVersion', 'fields']);
  if (document.schemaVersion !== 1) return reject();
  const seen = new Set<string>();
  const fields = list(document.fields).map(value => {
    const item = record(value, ['key', 'kind', 'required', 'minLength', 'maxLength']);
    const fieldKey = key(item.key);
    if (seen.has(fieldKey) || item.kind !== 'text' || typeof item.required !== 'boolean') return reject();
    seen.add(fieldKey);
    const minLength = bound(item.minLength), maxLength = bound(item.maxLength);
    if (minLength > maxLength || (item.required && maxLength === 0)) return reject();
    return Object.freeze({ key: fieldKey, kind: 'text' as const, required: item.required, minLength, maxLength });
  });
  return Object.freeze({ schemaVersion: 1 as const, fields: Object.freeze(fields) });
}
export function parseTextFieldDocument(input: unknown): TextFieldDocument {
  try { return parseFields(input); } catch { return reject(); }
}
export function parseTextAnswers(fieldDocument: unknown, input: unknown): TextAnswerDocument {
  try {
    const fields = parseFields(fieldDocument).fields;
    const document = record(input, ['schemaVersion', 'answers']);
    if (document.schemaVersion !== 1) return reject();
    const seen = new Set<string>();
    const answers = list(document.answers).map(value => {
      const item = record(value, ['key', 'value']);
      const answerKey = key(item.key);
      const field = fields.find(candidate => candidate.key === answerKey);
      if (!field || seen.has(answerKey) || typeof item.value !== 'string' || item.value.length > 8192) return reject();
      const text = item.value;
      let count = 0;
      for (const character of text) {
        const code = character.codePointAt(0)!;
        if ((code >= 0xd800 && code <= 0xdfff) || code === 10 || code === 13 || code === 0x2028 || code === 0x2029) return reject();
        count++;
      }
      // Empty or whitespace-only optional answers retain exact text and bypass minLength, not maxLength.
      const empty = text.trim().length === 0;
      if (count > field.maxLength || (empty ? field.required : count < field.minLength)) return reject();
      seen.add(answerKey);
      return Object.freeze({ key: answerKey, value: text });
    });
    if (fields.some(field => field.required && !seen.has(field.key))) return reject();
    return Object.freeze({ schemaVersion: 1 as const, answers: Object.freeze(answers) });
  } catch { return reject(); }
}
