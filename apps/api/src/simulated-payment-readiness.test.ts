import {afterEach, it, expect, vi} from 'vitest';
import type {Pool} from 'pg';
import {readdirSync, readFileSync} from 'node:fs';
import {
  SIMULATED_PROVIDERS,
  createSimulatedPaymentGuard,
  readSimulatedPaymentVerdict,
} from './simulated-payment-readiness';

afterEach(() => {vi.useRealTimers();});

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
/** The migrations that name the lumin_ database guard. Pinned: a new one fails here until someone reads its seed. */
const DISPOSABLE_SEED_FILES = ['0088_payment_provider_provenance.sql', '0094_stripe_connect_test_label.sql'];
/** One `if current_database() ~ '^lumin_' then ... end if;` seed block per file above. */
const EXPECTED_DISPOSABLE_SEED_BLOCKS = 2;
/** The live label 0088 seeds for every deployment: the one non-simulated label a seed block may name. */
const NON_SIMULATED_LABELS: readonly string[] = ['stripe_connect'];
const LABEL_SHAPE = /^[a-z][a-z0-9_]*$/;
/** Every database-name guard that opens a conditional, whatever it compares. A guard the reader does not parse fails. */
const DATABASE_GUARD = /if\s+current_database\(\)/gi;
/** A guard that names the lumin_ family, in any operator a migration uses for it (~, like, =). */
const DISPOSABLE_GUARD = /if\s+current_database\(\)\s*(?:~|like|=)\s*'[^']*lumin[^']*'\s*then/gi;

/** SQL with its comments removed. A quoted literal is kept whole, so a `--` or an apostrophe inside one is not a comment. */
function stripSqlComments(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*/g, (token) => (token.startsWith('--') ? '' : token));
}

/** The same SQL with each quoted literal's contents blanked and its length kept, so note text is never read as code. */
function blankLiterals(sql: string): string {
  return sql.replace(/'((?:[^']|'')*)'/g, (_literal, inner: string) => `'${'_'.repeat(inner.length)}'`);
}

interface DisposableSeedBlock {
  file: string;
  /** The text between the guard's `then` and its `end if;`, comments removed. */
  body: string;
}

/**
 * The disposable-database seed blocks in the given migrations. `mentioning` lists each migration with a lumin_
 * guard in any spelling. A `current_database()` guard the reader does not parse is a named failure: a seed
 * spelled in a way this reader misses would never reach SIMULATED_PROVIDERS, and the check would pass.
 */
function disposableSeedsIn(files: ReadonlyArray<{name: string; raw: string}>): {
  mentioning: string[];
  blocks: DisposableSeedBlock[];
} {
  const mentioning: string[] = [];
  const blocks: DisposableSeedBlock[] = [];
  for (const {name: file, raw} of files) {
    const sql = stripSqlComments(raw);
    const seeds = [...sql.matchAll(DISPOSABLE_GUARD)];
    if (seeds.length !== [...sql.matchAll(DATABASE_GUARD)].length) {
      throw new Error(`${file}: a current_database() guard this reader does not parse`);
    }
    if (seeds.length > 0) mentioning.push(file);
    const blanked = blankLiterals(sql);
    for (const guard of seeds) {
      if (guard.index === undefined) throw new Error(`${file}: a lumin_ guard has no position`);
      const from = guard.index + guard[0].length;
      const end = /\bend\s+if\s*;/i.exec(blanked.slice(from));
      if (!end) throw new Error(`${file}: a lumin_ seed guard has no end if;`);
      const to = from + end.index;
      if (/\bif\b/i.test(blanked.slice(from, to))) {
        throw new Error(`${file}: a lumin_ seed guard holds a nested conditional, which this reader does not follow`);
      }
      blocks.push({file, body: sql.slice(from, to)});
    }
  }
  return {mentioning, blocks};
}

/** Every disposable-database seed block in every 0*.sql migration, found by reading the directory. */
function disposableSeeds(): {mentioning: string[]; blocks: DisposableSeedBlock[]} {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^0.*\.sql$/.test(name))
    .sort()
    .map((name) => ({name, raw: readFileSync(new URL(name, MIGRATIONS), 'utf8')}));
  return disposableSeedsIn(files);
}

interface SeedPair {
  label: string;
  note: string;
}

/**
 * The (label, note) pairs in a seed block. Every quoted token must sit in a pair: a stray one throws
 * here, rather than being left out of the label check.
 */
function seedPairs(body: string): SeedPair[] {
  const pairs = [...body.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)].map((match) => ({
    label: match[1]!,
    note: match[2]!,
  }));
  const quoted = body.match(/'(?:[^']|'')*'/g) ?? [];
  if (quoted.length !== pairs.length * 2) {
    throw new Error('a disposable seed block has quoted tokens that are not a (label, note) pair');
  }
  return pairs;
}

/** Every label a disposable-database seed declares confirmable, read from the migrations. */
function disposableSeedLabels(): string[] {
  const labels = new Set<string>();
  for (const block of disposableSeeds().blocks) {
    for (const {label} of seedPairs(block.body)) labels.add(label);
  }
  return [...labels];
}

interface Recorder {
  pool: Pool;
  sql: string[];
  params: unknown[][];
  connects: number;
  released: boolean[];
}

/** Fake pool whose allowlist SELECT returns the given providers. */
function fakePool(options: {rows?: string[][]; failOn?: string; failConnect?: boolean} = {}): Recorder {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const released: boolean[] = [];
  let call = 0;
  const recorder = {
    sql, params, released, connects: 0,
    pool: {
      async connect() {
        recorder.connects += 1;
        if (options.failConnect) throw new Error('pool exhausted');
        return {
          async query(text: string, values?: unknown[]) {
            sql.push(text);
            if (values) params.push(values);
            if (options.failOn && text.includes(options.failOn)) throw new Error('query failed');
            if (text.includes('confirmable_payment_providers')) {
              const rows = (options.rows ?? [])[Math.min(call, (options.rows ?? []).length - 1)] ?? [];
              call += 1;
              return {rows: rows.map((provider) => ({provider}))};
            }
            return {rows: []};
          },
          release(broken?: boolean) {released.push(broken === true);},
        };
      },
    } as unknown as Pool,
  };
  return recorder;
}

it('never touches the database for a staging process', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'staging')).toEqual({status: 'safe'});
  expect(r.connects).toBe(0);
});

it('asks the allowlist read-only, as service_role, for exactly the simulated providers', async () => {
  const r = fakePool({rows: [[]]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'production')).toEqual({status: 'safe'});
  expect(r.sql[0]).toBe('begin isolation level read committed read only');
  expect(r.sql).toContain('set local role service_role');
  expect(r.sql.at(-1)).toBe('commit');
  // The question asked is parameterized and names only simulated providers, so
  // the gate can neither be widened by a value nor write anything.
  expect(r.params).toEqual([[SIMULATED_PROVIDERS]]);
  expect(r.sql.some((text) => text.startsWith('select provider from public.confirmable_payment_providers'))).toBe(true);
  expect(r.sql.join(' ')).not.toMatch(/insert|update|delete/i);
  expect(r.released).toEqual([false]);
});

it('reports UNSAFE when a non-staging process can confirm simulated money', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'production')).toEqual({status: 'unsafe', providers: ['staging_mock']});
  // An unset environment is not staging either: the dangerous default is covered.
  expect(await readSimulatedPaymentVerdict(fakePool({rows: [['staging_mock']]}).pool, undefined))
    .toEqual({status: 'unsafe', providers: ['staging_mock']});
  // EITHER simulated label is enough. 'fixture' is what the confirmation
  // integration harnesses hand-seed, and migration 0088 declares it confirmable
  // on lumin_* databases, so a restored CI dump must trip the guard too.
  expect(await readSimulatedPaymentVerdict(fakePool({rows: [['fixture']]}).pool, 'production'))
    .toEqual({status: 'unsafe', providers: ['fixture']});
  expect(await readSimulatedPaymentVerdict(fakePool({rows: [['fixture', 'staging_mock']]}).pool, 'production'))
    .toEqual({status: 'unsafe', providers: ['fixture', 'staging_mock']});
});

it('asks about every label any disposable seed declares confirmable on a lumin_* database', () => {
  // If a disposable seed gains a provider and this list does not, the DB would confirm
  // non-real money that the readiness guard never asks about. The labels are read from the
  // migrations, and the three expected here are written out ON PURPOSE: a seed that gains a
  // label fails this test until the list and SIMULATED_PROVIDERS change in the same commit.
  // A reader that compared the migrations only with SIMULATED_PROVIDERS would agree with a
  // drift in both at once.
  const declared = disposableSeedLabels().sort();
  expect(declared).toEqual(['fixture', 'staging_mock', 'stripe_connect_test']);
  expect([...SIMULATED_PROVIDERS].sort()).toEqual(declared);
});

it('finds the disposable seed in every migration that names the lumin_ guard, and pins the block count', () => {
  const {mentioning, blocks} = disposableSeeds();
  expect(mentioning).toEqual(DISPOSABLE_SEED_FILES);
  expect(blocks.map((block) => block.file)).toEqual(DISPOSABLE_SEED_FILES);
  expect(blocks.length).toBe(EXPECTED_DISPOSABLE_SEED_BLOCKS);
});

it('holds every label a disposable seed names to the label shape and to the known labels, skipping none', () => {
  const known: readonly string[] = [...SIMULATED_PROVIDERS, ...NON_SIMULATED_LABELS];
  for (const {file, body} of disposableSeeds().blocks) {
    expect(body, `${file} inserts into (provider, note)`).toMatch(
      /insert\s+into\s+public\.confirmable_payment_providers\s*\(\s*provider\s*,\s*note\s*\)/,
    );
    const pairs = seedPairs(body);
    expect(pairs.length, `${file} declares a label`).toBeGreaterThan(0);
    for (const {label} of pairs) {
      expect(label, `${file}: label shape`).toMatch(LABEL_SHAPE);
      expect(known, `${file}: label ${label} is simulated or stripe_connect`).toContain(label);
    }
  }
});

it('reads a disposable seed spelled with like, and refuses a database guard it does not parse', () => {
  // Written by a future migration, not on disk: the reader must see the seed whatever operator spells the guard,
  // or a label it never sees is never asked about, and the checks above would still pass.
  const like = [
    'do $seed$ begin',
    "  if current_database() like 'lumin_%' then",
    "    insert into public.confirmable_payment_providers (provider, note) values ('fixture_v2', 'x');",
    '  end if;',
    'end $seed$;',
  ].join('\n');
  const parsed = disposableSeedsIn([{name: '9999_synthetic.sql', raw: like}]);
  expect(parsed.mentioning).toEqual(['9999_synthetic.sql']);
  expect(parsed.blocks.map((block) => seedPairs(block.body).map((pair) => pair.label))).toEqual([['fixture_v2']]);
  // A database-name guard the reader cannot read is a failure, never an absence.
  const other = ['do $g$ begin', "  if current_database() <> 'postgres' then", '    null;', '  end if;', 'end $g$;'].join('\n');
  expect(() => disposableSeedsIn([{name: '9998_synthetic.sql', raw: other}])).toThrow(/does not parse/);
});

it('reports UNKNOWN, never safe, when the question cannot be answered', async () => {
  // A database without 0088 applied, or an unreachable one, must not read as a
  // clean bill of health -- and must not brick a deploy either.
  const missing = fakePool({failOn: 'confirmable_payment_providers'});
  expect(await readSimulatedPaymentVerdict(missing.pool, 'production')).toEqual({status: 'unknown'});
  expect(missing.sql).toContain('rollback');
  expect(missing.released).toEqual([false]);
  const unreachable = fakePool({failConnect: true});
  expect(await readSimulatedPaymentVerdict(unreachable.pool, 'production')).toEqual({status: 'unknown'});
  // A connection that cannot even roll back is discarded rather than reused.
  const discarded: boolean[] = [];
  const broken = {
    async connect() {
      return {
        async query(text: string) {
          if (text.includes('select provider') || text === 'rollback') throw new Error('socket gone');
          return {rows: []};
        },
        release(flag?: boolean) {discarded.push(flag === true);},
      };
    },
  } as unknown as Pool;
  expect(await readSimulatedPaymentVerdict(broken, 'production')).toEqual({status: 'unknown'});
  expect(discarded).toEqual([true]);
});

it('stops serving once unsafe and reports a reason with no row dump or secret', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  const onUnsafe = vi.fn();
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 60_000, onUnsafe});
  expect(guard.serving()).toBe(true);
  expect(guard.reason()).toBeNull();
  expect(await guard.check()).toEqual({status: 'unsafe', providers: ['staging_mock']});
  expect(guard.serving()).toBe(false);
  expect(guard.reason()).toBe('database confirms simulated payment providers while BOOKING_LUMIN_ENV is not staging');
  expect(onUnsafe).toHaveBeenCalledTimes(1);
  expect(onUnsafe).toHaveBeenCalledWith(guard.reason(), ['staging_mock']);
  guard.stop();
});

it('latches: a later clean read does not resume serving, and does not re-notify', async () => {
  // Restores are not undone by the allowlist changing afterwards; the process
  // has already been seen in front of a simulated-money database.
  const r = fakePool({rows: [['staging_mock'], []]});
  const onUnsafe = vi.fn();
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 60_000, onUnsafe});
  await guard.check();
  expect(await guard.check()).toEqual({status: 'safe'});
  expect(guard.serving()).toBe(false);
  expect(onUnsafe).toHaveBeenCalledTimes(1);
  guard.stop();
});

it('a notification failure does not mask the refusal', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {
    onUnsafe: () => {throw new Error('logger exploded');},
  });
  await expect(guard.check()).resolves.toEqual({status: 'unsafe', providers: ['staging_mock']});
  expect(guard.serving()).toBe(false);
  guard.stop();
});

it('re-checks on the timer so a restore under a running process is caught, and stop() ends it', async () => {
  vi.useFakeTimers();
  const r = fakePool({rows: [[], ['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 1000});
  expect(await guard.check()).toEqual({status: 'safe'});
  expect(guard.serving()).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(guard.serving()).toBe(false);
  const connectsAtTrip = r.connects;
  guard.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(r.connects).toBe(connectsAtTrip);
});

it('a staging guard costs no connection even on the timer', async () => {
  vi.useFakeTimers();
  const r = fakePool({rows: [['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'staging', {intervalMs: 1000});
  expect(await guard.check()).toEqual({status: 'safe'});
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.connects).toBe(0);
  expect(guard.serving()).toBe(true);
  guard.stop();
});

it('clamps an out-of-range interval instead of spinning or never checking', async () => {
  vi.useFakeTimers();
  for (const intervalMs of [0, -1, 1.5, 10_000_000, Number.NaN]) {
    const r = fakePool({rows: [[]]});
    const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs});
    await vi.advanceTimersByTimeAsync(59_000);
    expect(r.connects).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.connects).toBe(1);
    guard.stop();
  }
});
