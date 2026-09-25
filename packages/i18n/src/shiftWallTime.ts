import { rosterInstantMicros } from '@lumin/contracts';

export interface ShiftWallTimeInput { readonly wallTime: string; readonly timeZone: string }
export interface ShiftWallCandidate { readonly instant: string; readonly offsetMinutes: number }
export interface ShiftWallResolution {
  readonly resolutionVersion: 1;
  readonly input: ShiftWallTimeInput;
  readonly resolverVersion: string;
  readonly dataVersion: string;
  readonly outcome: 'unique' | 'ambiguous' | 'nonexistent' | 'unsupported' | 'invalid';
  readonly candidates: readonly ShiftWallCandidate[];
}
export interface ShiftWallSelection { readonly instant: string; readonly offsetMinutes: number }
export interface ShiftWallInterval { readonly startsAt: string; readonly endsAt: string }

const fail = (): never => { throw new Error('INVALID_SHIFT_WALL_TIME_CONTRACT'); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return fail();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail();
    copy[key] = descriptor.value;
  }
  return copy;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}
function wall(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const match = /^(20\d\d|2100)-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
  if (!match) return fail();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 2020 || month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(match[4]) > 23 || Number(match[5]) > 59) return fail();
  return value;
}
function zone(value: unknown): string {
  const name = text(value, 100);
  // Syntax only; the resolver and its registry decide whether this name exists.
  if (!/^[A-Za-z][A-Za-z0-9._+\/-]*$/.test(name) || name.includes('..') || name.endsWith('/')) return fail();
  return name;
}
export function parseShiftWallTimeInput(value: unknown): ShiftWallTimeInput {
  try {
    const data = record(value, ['wallTime', 'timeZone']);
    return Object.freeze({ wallTime: wall(data.wallTime), timeZone: zone(data.timeZone) });
  } catch { return fail(); }
}
function version(value: unknown): string {
  const result = text(value, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(result)) return fail();
  return result;
}
function candidate(value: unknown, input: ShiftWallTimeInput): ShiftWallCandidate {
  const data = record(value, ['instant', 'offsetMinutes']);
  if (typeof data.instant !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(data.instant)) return fail();
  const instant = rosterInstantMicros(data.instant);
  if (instant === null || typeof data.offsetMinutes !== 'number' || !Number.isInteger(data.offsetMinutes) || data.offsetMinutes < -900 || data.offsetMinutes > 900 || Object.is(data.offsetMinutes, -0)) return fail();
  const local = instant + BigInt(data.offsetMinutes) * 60_000_000n;
  const expected = rosterInstantMicros(input.wallTime + ':00.000000Z');
  if (expected === null || local !== expected) return fail();
  return Object.freeze({ instant: data.instant, offsetMinutes: data.offsetMinutes });
}
function candidateList(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length > 2) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|1)$/.test(key)))) return fail();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail();
    result.push(descriptor.value);
  }
  return result;
}
/** Validates a supplied resolver result; this module never resolves zones or grants server authority. */
export function parseShiftWallResolution(value: unknown): ShiftWallResolution {
  try {
    const data = record(value, ['resolutionVersion', 'input', 'resolverVersion', 'dataVersion', 'outcome', 'candidates']);
    if (data.resolutionVersion !== 1) return fail();
    const input = parseShiftWallTimeInput(data.input);
    const outcome = data.outcome;
    if (outcome !== 'unique' && outcome !== 'ambiguous' && outcome !== 'nonexistent' && outcome !== 'unsupported' && outcome !== 'invalid') return fail();
    const candidates = candidateList(data.candidates).map(value => candidate(value, input));
    if ((outcome === 'unique' && candidates.length !== 1) || (outcome === 'ambiguous' && candidates.length !== 2) || (outcome !== 'unique' && outcome !== 'ambiguous' && candidates.length !== 0)) return fail();
    if (candidates.length === 2 && rosterInstantMicros(candidates[0]!.instant)! >= rosterInstantMicros(candidates[1]!.instant)!) return fail();
    return Object.freeze({ resolutionVersion: 1 as const, input, resolverVersion: version(data.resolverVersion), dataVersion: version(data.dataVersion), outcome, candidates: Object.freeze(candidates) });
  } catch { return fail(); }
}
/** Selection requires exact resolver provenance and a deliberate candidate in a fold. */
export function selectShiftWallInstant(resolution: unknown, expectedInput: unknown, resolverVersion: string, dataVersion: string, chosenInstant?: string): ShiftWallSelection {
  const result = parseShiftWallResolution(resolution);
  const expected = parseShiftWallTimeInput(expectedInput);
  if (result.input.wallTime !== expected.wallTime || result.input.timeZone !== expected.timeZone || result.resolverVersion !== version(resolverVersion) || result.dataVersion !== version(dataVersion)) return fail();
  if (result.outcome !== 'unique' && result.outcome !== 'ambiguous') return fail();
  if (result.outcome === 'ambiguous' && chosenInstant === undefined) return fail();
  const choice = result.candidates.find(item => item.instant === (chosenInstant ?? result.candidates[0]?.instant));
  if (!choice || (chosenInstant !== undefined && choice.instant !== chosenInstant)) return fail();
  return Object.freeze({ instant: choice.instant, offsetMinutes: choice.offsetMinutes });
}
export function selectShiftWallInterval(start: unknown, end: unknown, expectedStart: unknown, expectedEnd: unknown, resolverVersion: string, dataVersion: string, chosenStart?: string, chosenEnd?: string): ShiftWallInterval {
  const startsAt = selectShiftWallInstant(start, expectedStart, resolverVersion, dataVersion, chosenStart).instant;
  const endsAt = selectShiftWallInstant(end, expectedEnd, resolverVersion, dataVersion, chosenEnd).instant;
  const a = rosterInstantMicros(startsAt), b = rosterInstantMicros(endsAt);
  if (a === null || b === null || b <= a) return fail();
  return Object.freeze({ startsAt, endsAt });
}
