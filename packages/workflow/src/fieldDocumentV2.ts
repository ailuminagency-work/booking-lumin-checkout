/** Separate V2 non-commerce contract; V1 remains unchanged; not a Selection, publication or authorization API.
 * Callers must enforce raw request-byte limits before JSON decoding. Reflective proxy
 * traps cannot be avoided in JavaScript; failures reject, and getters are never read.
 */
export interface FieldV2 { readonly key: string; readonly kind: 'text' | 'textarea'; readonly required: boolean; readonly minLength: number; readonly maxLength: number; readonly prompt?: string }
export interface FieldDocumentV2 { readonly schemaVersion: 2; readonly fields: readonly FieldV2[] }
export const rejectV2 = (): never => { throw new Error('INVALID_FIELD_V2_CONTRACT'); };
export function recordV2(input: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object') return rejectV2();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return rejectV2();
  const own = Reflect.ownKeys(input);
  if (own.length < keys.length || own.length > keys.length + optional.length || own.some(key => typeof key !== 'string' || (!keys.includes(key) && !optional.includes(key)))) return rejectV2();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of [...keys, ...optional.filter(key => own.includes(key))]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return rejectV2();
    result[key] = descriptor.value;
  }
  return result;
}
export function listV2(input: unknown): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return rejectV2();
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !('value' in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > 64) return rejectV2();
  const count: number = length.value;
  if (Reflect.ownKeys(input).length !== count + 1) return rejectV2();
  const output: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return rejectV2();
    output.push(descriptor.value);
  }
  return output;
}
export function keyV2(input: unknown): string {
  if (typeof input !== 'string' || input.length > 64 || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input) || ['__proto__', 'prototype', 'constructor'].includes(input)) return rejectV2();
  return input;
}
function bound(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > 4096) return rejectV2();
  return input;
}
/** Exact plain-text metadata; omission is preserved. Older strict readers need a coordinated rollout. */
function prompt(input: unknown): string {
  if (typeof input !== 'string' || input.length > 400 || input.trim().length === 0) return rejectV2();
  let count = 0;
  for (const character of input) {
    const code = character.codePointAt(0)!;
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code === 10 || code === 13 || code === 0x2028 || code === 0x2029 || ++count > 200) return rejectV2();
  }
  return input;
}
function parseFields(input: unknown): FieldDocumentV2 {
  const document = recordV2(input, ['schemaVersion', 'fields']);
  if (document.schemaVersion !== 2) return rejectV2();
  const seen = new Set<string>();
  const fields = listV2(document.fields).map(value => {
    const item = recordV2(value, ['key', 'kind', 'required', 'minLength', 'maxLength'], ['prompt']);
    const fieldKey = keyV2(item.key);
    if (seen.has(fieldKey) || (item.kind !== 'text' && item.kind !== 'textarea') || typeof item.required !== 'boolean') return rejectV2();
    seen.add(fieldKey);
    const minLength = bound(item.minLength), maxLength = bound(item.maxLength);
    if (minLength > maxLength || (item.required && maxLength === 0)) return rejectV2();
    return Object.freeze({ key: fieldKey, kind: item.kind, required: item.required, minLength, maxLength, ...('prompt' in item ? { prompt: prompt(item.prompt) } : {}) });
  });
  return Object.freeze({ schemaVersion: 2 as const, fields: Object.freeze(fields) });
}
export function parseFieldDocumentV2(input: unknown): FieldDocumentV2 {
  try { return parseFields(input); } catch { return rejectV2(); }
}
