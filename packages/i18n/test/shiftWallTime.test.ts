import { expect, it, vi } from 'vitest';
import { parseShiftWallTimeInput, parseShiftWallResolution, selectShiftWallInstant, selectShiftWallInterval } from '../src/shiftWallTime';

const start = () => ({ wallTime: '2030-11-03T01:30', timeZone: 'America/New_York' });
const end = () => ({ wallTime: '2030-11-03T02:30', timeZone: 'America/New_York' });
const fold = () => ({ resolutionVersion: 1, input: start(), resolverVersion: 'resolver-1', dataVersion: 'tzdb-2030a', outcome: 'ambiguous', candidates: [
  { instant: '2030-11-03T05:30:00.000000Z', offsetMinutes: -240 },
  { instant: '2030-11-03T06:30:00.000000Z', offsetMinutes: -300 },
] });
const uniqueEnd = () => ({ resolutionVersion: 1, input: end(), resolverVersion: 'resolver-1', dataVersion: 'tzdb-2030a', outcome: 'unique', candidates: [
  { instant: '2030-11-03T07:30:00.000000Z', offsetMinutes: -300 },
] });

it('accepts exact Gregorian minute walls and syntax-bounded zone labels without resolving them', () => {
  expect(parseShiftWallTimeInput({ wallTime: '2020-02-29T00:00', timeZone: 'posix/UTC' })).toEqual({ wallTime: '2020-02-29T00:00', timeZone: 'posix/UTC' });
  expect(parseShiftWallTimeInput({ wallTime: '2100-12-31T23:59', timeZone: 'Unknown/Registry_Zone' }).timeZone).toBe('Unknown/Registry_Zone');
  for (const wallTime of ['2019-12-31T23:59', '2101-01-01T00:00', '2100-02-29T00:00', '2020-02-30T00:00', '2030-13-01T00:00', '2030-11-03T24:00', '2030-11-03T01:60', '2030-11-03T01:30:00'])
    expect(() => parseShiftWallTimeInput({ wallTime, timeZone: 'UTC' })).toThrow();
  for (const timeZone of ['', '../UTC', 'America/', 'A'.repeat(101), 'A\nB', 3])
    expect(() => parseShiftWallTimeInput({ wallTime: start().wallTime, timeZone })).toThrow();
});
it('rejects extra fields, accessors, throwing proxies and cycles without reading secret getters', () => {
  const getter = vi.fn(() => 'secret');
  const input = Object.defineProperty({ wallTime: start().wallTime }, 'timeZone', { enumerable: true, get: getter });
  expect(() => parseShiftWallTimeInput(input)).toThrow();
  const candidate = Object.defineProperty({ offsetMinutes: -240 }, 'instant', { enumerable: true, get: getter });
  expect(() => parseShiftWallResolution({ ...fold(), candidates: [candidate] })).toThrow();
  const accessorCandidates = [fold().candidates[0]];
  Object.defineProperty(accessorCandidates, '0', { enumerable: true, get: getter });
  expect(() => parseShiftWallResolution({ ...fold(), candidates: accessorCandidates })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => parseShiftWallTimeInput({ ...start(), actorId: 'private' })).toThrow();
  expect(() => parseShiftWallTimeInput(new Proxy({}, { getPrototypeOf() { throw Error('private'); } }))).toThrow('INVALID_SHIFT_WALL_TIME_CONTRACT');
  const getTrap = vi.fn(() => 'secret');
  expect(() => parseShiftWallTimeInput(new Proxy(start(), { get: getTrap }))).not.toThrow();
  expect(getTrap).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = { wallTime: start().wallTime }; cyclic.timeZone = cyclic;
  expect(() => parseShiftWallTimeInput(cyclic)).toThrow();
});
it('requires bounded, chronological and exact wall-consistent candidates', () => {
  expect(parseShiftWallResolution(fold()).candidates).toHaveLength(2);
  for (const candidates of [
    [...fold().candidates].reverse(),
    [fold().candidates[0], fold().candidates[0]],
    [...fold().candidates, fold().candidates[0]],
    [{ ...fold().candidates[0], offsetMinutes: -300 }],
    [{ ...fold().candidates[0], instant: '2030-11-03T05:30:00.000001Z' }],
    [{ ...fold().candidates[0], offsetMinutes: 901 }],
  ]) expect(() => parseShiftWallResolution({ ...fold(), candidates })).toThrow();
  for (const outcome of ['unique', 'nonexistent', 'unsupported', 'invalid'])
    expect(() => parseShiftWallResolution({ ...fold(), outcome })).toThrow();
  expect(() => parseShiftWallResolution({ ...fold(), resolutionVersion: 2 })).toThrow();
  expect(() => parseShiftWallResolution({ ...fold(), extra: true })).toThrow();
});
it('requires exact input and resolver provenance with deliberate fold choice', () => {
  expect(() => selectShiftWallInstant(fold(), start(), 'resolver-1', 'tzdb-2030a')).toThrow();
  expect(selectShiftWallInstant(fold(), start(), 'resolver-1', 'tzdb-2030a', fold().candidates[1]!.instant)).toEqual(fold().candidates[1]);
  for (const [input, resolver, data] of [[{ ...start(), timeZone: 'Etc/UTC' }, 'resolver-1', 'tzdb-2030a'], [start(), 'resolver-2', 'tzdb-2030a'], [start(), 'resolver-1', 'tzdb-2030b']] as const)
    expect(() => selectShiftWallInstant(fold(), input, resolver, data, fold().candidates[0]!.instant)).toThrow();
  expect(() => selectShiftWallInstant(fold(), start(), 'resolver-1', 'tzdb-2030a', '2030-11-03T08:30:00.000000Z')).toThrow();
  for (const outcome of ['nonexistent', 'unsupported', 'invalid'] as const)
    expect(() => selectShiftWallInstant({ ...fold(), outcome, candidates: [] }, start(), 'resolver-1', 'tzdb-2030a')).toThrow();
});
it('selects start and end independently and requires a strictly positive instant interval', () => {
  const chosen = fold().candidates[1]!.instant;
  expect(selectShiftWallInterval(fold(), uniqueEnd(), start(), end(), 'resolver-1', 'tzdb-2030a', chosen)).toEqual({ startsAt: chosen, endsAt: uniqueEnd().candidates[0]!.instant });
  expect(() => selectShiftWallInterval(uniqueEnd(), fold(), end(), start(), 'resolver-1', 'tzdb-2030a', undefined, chosen)).toThrow();
  expect(() => selectShiftWallInterval(fold(), fold(), start(), start(), 'resolver-1', 'tzdb-2030a', chosen, chosen)).toThrow();
});
it('returns detached immutable trees and is independent of process timezone', () => {
  const raw = fold(); const parsed = parseShiftWallResolution(raw);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.input)).toBe(true);
  expect(Object.isFrozen(parsed.candidates)).toBe(true);
  expect(Object.isFrozen(parsed.candidates[0])).toBe(true);
  raw.candidates[0]!.offsetMinutes = 0;
  expect(parsed.candidates[0]!.offsetMinutes).toBe(-240);
  const first = selectShiftWallInstant(fold(), start(), 'resolver-1', 'tzdb-2030a', fold().candidates[0]!.instant);
  const prior = process.env.TZ;
  try { process.env.TZ = 'Pacific/Honolulu'; expect(selectShiftWallInstant(fold(), start(), 'resolver-1', 'tzdb-2030a', fold().candidates[0]!.instant)).toEqual(first); }
  finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});
it('accepts year-edge UTC candidates and half or quarter-hour offsets by exact arithmetic', () => {
  const cases = [
    { wallTime: '2020-01-01T00:00', instant: '2019-12-31T23:00:00.000000Z', offsetMinutes: 60 },
    { wallTime: '2100-12-31T23:59', instant: '2101-01-01T00:59:00.000000Z', offsetMinutes: -60 },
    { wallTime: '2020-01-01T00:00', instant: '2019-12-31T23:30:00.000000Z', offsetMinutes: 30 },
    { wallTime: '2020-01-01T00:00', instant: '2019-12-31T23:15:00.000000Z', offsetMinutes: 45 },
  ];
  for (const item of cases) {
    const input = { wallTime: item.wallTime, timeZone: 'Unknown/Zone' };
    const resolution = { resolutionVersion: 1, input, resolverVersion: 'r1', dataVersion: 'd1', outcome: 'unique', candidates: [{ instant: item.instant, offsetMinutes: item.offsetMinutes }] };
    expect(selectShiftWallInstant(resolution, input, 'r1', 'd1')).toEqual(resolution.candidates[0]);
  }
});
it('accepts a zero-candidate gap envelope but refuses selection', () => {
  const gap = { ...fold(), outcome: 'nonexistent', candidates: [] };
  expect(parseShiftWallResolution(gap).candidates).toEqual([]);
  expect(() => selectShiftWallInstant(gap, start(), 'resolver-1', 'tzdb-2030a')).toThrow('INVALID_SHIFT_WALL_TIME_CONTRACT');
});
