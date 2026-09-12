/** Independent actual PostgreSQL acceptance; fresh disposable databases only. */
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createLocalModeSessionAdmission } from './mode-session-admission.js';
import { __createModeSessionRepositoryForTests as repository } from './mode-session-repository.js';
import { recordedPool as recordNativePool, terminal, rejected, config, setup, prepared, snapshot, holder as nativeHolder, profile, issueRequest, blocked, gone, observe, pause, lossProxy as nativeProxy } from './mode-session-admission-fixtures.js';

let faulted = false;
const error = () => { faulted = true; };
const warning = () => { faulted = true; };
const cleanups: Array<() => Promise<unknown>> = [];
function own<T>(value: T, cleanup: (value: T) => unknown): T {
  assert.ok(cleanups.length < 64, 'bounded owned resources');
  let done: Promise<unknown> | undefined;
  cleanups.push(() => done ??= Promise.resolve().then(() => cleanup(value)));
  return value;
}
function recordedPool(...args: Parameters<typeof recordNativePool>) {
  return own(recordNativePool(...args), raw => raw.shutdown());
}
function admission(raw: ReturnType<typeof recordedPool>) {
  return own(createLocalModeSessionAdmission(raw.pool), a => a.close());
}
function repo(a: ReturnType<typeof admission>) {
  return own(repository({ pool: a.pool, profiles: [profile] }), r => r.close());
}
async function holder(pool: Pool) {
  const c = await nativeHolder(pool), release = c.release;
  let released = false;
  const dispose = () => {
    if (!released) { released = true; Reflect.apply(release, c, [new Error('fixture holder cleanup')]); }
  };
  // Native holder's acquisition/setup already owns its failed-init disposal.
  own(c, dispose);
  const original = c.release;
  c.release = error => { if (!released) { released = true; Reflect.apply(original, c, [error]); } };
  return c;
}
async function lossProxy(...args: Parameters<typeof nativeProxy>) {
  return own(await nativeProxy(...args), proxy => proxy.close());
}
process.on('unhandledRejection', error);
process.on('warning', warning);
let observer!: Pool;
let cases = 0;
function pass(label: string) { cases++; console.log('PASS ' + label); }
function counts(a: ReturnType<typeof createLocalModeSessionAdmission>, active: number, quarantined: number, accepting = true) {
  const s = a.snapshot();
  assert.deepEqual(s, { capacity: 8, active, quarantined, free: 8 - active - quarantined, accepting });
  assert.equal(Object.isFrozen(s), true);
}
function issued(value: any) {
  assert.equal(value.kind, 'committed');
  assert.equal(value.delivery, 'session');
  assert.ok(value.receipt.sessionId);
  return value;
}
try {
  observer = own(new Pool({ ...config(), max: 4 }), pool => pool.end());
  observer.on('error', error);
  await setup(observer);
  // This trusted consumer validates every real terminal tag before normal release.
  {
    const raw = recordedPool(), a = admission(raw);
    try {
      assert.equal(createLocalModeSessionAdmission(raw.pool), a);
      const first = await a.pool.connect();
      const oldCallback = () => {};
      first.on('error', oldCallback);
      const firstListeners = raw.records[0]!.listeners();
      assert.equal(firstListeners.captured, 2);
      assert.equal(firstListeners.attached, 2);
      assert.equal(firstListeners.errorCount, firstListeners.baselineError + 1);
      assert.equal(firstListeners.endCount, firstListeners.baselineEnd + 1);
      await terminal(first);
      first.release();
      counts(a, 0, 0);
      const releasedListeners = raw.records[0]!.listeners();
      assert.equal(releasedListeners.attached, 0);
      assert.equal(releasedListeners.errorCount, firstListeners.baselineError + 1, 'pool owns its idle error consumer');
      assert.equal(releasedListeners.endCount, firstListeners.baselineEnd);
      const second = await a.pool.connect();
      counts(a, 1, 0);
      assert.equal(raw.records[0]!.pid, raw.records[1]!.pid);
      assert.notEqual(raw.records[0]!.releaseIdentity, raw.records[1]!.releaseIdentity);
      const currentListeners = raw.records[1]!.listeners();
      assert.equal(currentListeners.captured, 2);
      assert.equal(currentListeners.attached, 2);
      first.removeListener('error', oldCallback);
      assert.deepEqual(raw.records[1]!.listeners(), currentListeners);
      const before = raw.records.map(r => [r.queries, r.releases]);
      await rejected(() => first.query('SELECT 1'));
      await rejected(() => first.release());
      await rejected(() => first.on('error', () => {}));
      assert.deepEqual(raw.records.map(r => [r.queries, r.releases]), before);
      counts(a, 1, 0);
      await terminal(second);
      second.release();
      counts(a, 0, 0);
      assert.deepEqual(raw.records.map(r => r.releases), [1, 1]);
      assert.equal((await a.close()).driverEnd, 'fulfilled');
      assert.equal(raw.counts().ends, 1);
      assert.equal(a.pool.end(), a.pool.end());
      assert.equal(createLocalModeSessionAdmission(raw.pool), a);
      counts(a, 0, 0, false);
    } finally { raw.cleanup(); await a.close(); }
    pass('native same-PID reuse captures distinct checkout release and isolates stale lease');
  }
  {
    const x = await prepared(observer), raw = recordedPool(), a = admission(raw);
    const r = repo(a);
    try {
      issued(await r.issue(issueRequest(x)));
      issued(await r.issue(issueRequest(x)));
      counts(a, 0, 0);
      assert.equal(raw.records.length, 2);
      assert.equal(raw.records[0]!.pid, raw.records[1]!.pid);
      assert.ok(raw.records.every(row => row.commands.at(-1) === 'COMMIT' && row.releases === 1 && row.badReleases === 0));
    } finally { await r.close(); raw.cleanup(); await a.close(); }
    pass('accepted repository actual COMMIT success recycles native admission');
  }
  {
    const x = await prepared(observer), raw = recordedPool(), a = admission(raw);
    const hold = await holder(observer);
    try {
      await hold.query('select id from public.services where id=$1 for update', [x.f.service]);
      const c = await a.pool.connect();
      assert.equal((await c.query('BEGIN')).command, 'BEGIN');
      const pending = c.query('select id from public.services where id=$1 for update', [x.f.service]);
      // Consume immediately; this is a real query, never a substituted result.
      const consumed = pending.then(() => 'fulfilled', () => 'rejected');
      const waiter = raw.records[0]!.pid;
      const holderPid = (hold as unknown as { processID: number }).processID;
      await blocked(observer, waiter, holderPid);
      const outward = await Promise.race([consumed, pause(100).then(() => 'observation_timeout')]);
      assert.equal(outward, 'observation_timeout');
      await blocked(observer, waiter, holderPid);
      assert.equal(raw.records[0]!.pending, 1);
      counts(a, 1, 0);
      // Trusted observation timeout above is distinct from repository deadline semantics.
      c.release(new Error('synthetic disposal'));
      counts(a, 0, 1);
      await gone(observer, waiter);
      assert.equal(await consumed, 'rejected');
      counts(a, 0, 1);
      assert.equal(raw.records[0]!.releases, 1);
    } finally {
      await hold.query('ROLLBACK').catch(() => {});
      hold.release();
      raw.cleanup();
      await a.close();
    }
    pass('actual blocked SQL remains charged past outward observation then quarantine survives backend end');
  }
  {
    const x = await prepared(observer), raw = recordedPool(), a = admission(raw);
    const r = repo(a), hold = await holder(observer);
    const before = await snapshot(observer, x.f.tenant);
    try {
      await hold.query('select id from public.services where id=$1 for update', [x.f.service]);
      const abort = new AbortController();
      const pending = r.issue(issueRequest(x), { signal: abort.signal });
      await observe(async () => raw.records.length === 1, 'repository actual acquisition');
      const waiter = raw.records[0]!.pid;
      await blocked(observer, waiter, (hold as unknown as { processID: number }).processID);
      abort.abort();
      const result: any = await pending;
      assert.equal(result.kind, 'failed');
      assert.equal(result.code, 'ABORTED');
      counts(a, 0, 1);
      await gone(observer, waiter);
      assert.deepEqual(await snapshot(observer, x.f.tenant), before);
      await hold.query('ROLLBACK');
      issued(await r.issue(issueRequest(x)));
      counts(a, 0, 1);
      assert.notEqual(raw.records.at(-1)!.pid, waiter);
    } finally {
      await hold.query('ROLLBACK').catch(() => {});
      hold.release();
      await r.close(); raw.cleanup(); await a.close();
    }
    pass('accepted repository abort of actual blocked SQL retains quarantine through clean retry');
  }
  {
    const raw = recordedPool(), a = admission(raw);
    try {
      const lease = await a.pool.connect();
      await terminal(lease);
      const started = performance.now(), closing = a.close();
      assert.equal(a.close(), closing);
      const ended = a.pool.end();
      assert.equal(a.pool.end(), ended);
      // Real native pool.end waits for this intentionally retained checkout.
      assert.equal(raw.counts().ends, 1);
      counts(a, 0, 1, false);
      const result = await closing;
      assert.deepEqual(result, { driverEnd: 'unobserved' });
      assert.ok(performance.now() - started >= 9900, 'native ten-second observation cutoff');
      assert.equal(raw.counts().endSettled, false);
      await ended;
      counts(a, 0, 1, false);
      // Trusted fixture cleanup after observation; never a new consumer lease.
      raw.cleanup();
      await observe(async () => raw.counts().endSettled, 'late actual native pool.end fulfillment', 4000);
      assert.equal(await a.close(), result);
      assert.equal(raw.counts().ends, 1);
      counts(a, 0, 1, false);
    } finally { raw.cleanup(); await a.close(); }
    pass('native retained lease crosses close cutoff and late pool end cannot revise unobserved');
  }
  for (const rollback of [false, true]) {
    const x = await prepared(observer), before = await snapshot(observer, x.f.tenant);
    const proxy = await lossProxy(rollback ? 'ROLLBACK' : 'COMMIT');
    let initial = true, selected: any;
    const raw = recordedPool(proxy.port, async (c, text, run) => {
      if (text.startsWith('SELECT public.mode_issue')) {
        const result = await run();
        if (initial) selected = result.rows[0].result;
        return result;
      }
      if (text === 'COMMIT' && initial) {
        initial = false;
        // Existing supported fault: actual failed SQL makes actual COMMIT tag ROLLBACK.
        if (rollback) await c.query('select 1/0').catch(() => {});
      }
      return run();
    });
    const a = admission(raw), r = repo(a);
    try {
      const out: any = await r.issue(issueRequest(x));
      assert.equal(out.kind, 'unknown_commit');
      assert.equal(out.token, null);
      assert.equal(out.receipt, null);
      assert.ok(out.attempt);
      assert.equal(proxy.sawTag, true);
      assert.equal(proxy.sawReady, true);
      await gone(observer, raw.records[0]!.pid);
      counts(a, 0, 1);
      const after = await snapshot(observer, x.f.tenant);
      assert.equal(after.mode_flow_sessions.length, rollback ? 0 : 1);
      if (rollback) assert.deepEqual(after, before);
      const recovery: any = await r.recoverIssue(out.attempt);
      assert.equal(recovery.priorIssuance, 'unknown');
      const success = issued(recovery.outcome);
      assert.equal(success.receipt.sessionId === selected.sessionId, !rollback);
      if (!rollback) assert.deepEqual(await snapshot(observer, x.f.tenant), after);
      counts(a, 0, 1);
      assert.deepEqual(proxy.errors, []);
    } finally { await r.close(); raw.cleanup(); await a.close(); await proxy.close(); }
    pass(`actual ${rollback ? 'ROLLBACK' : 'COMMIT'} response loss quarantines while database outcome and recovery remain separate`);
  }
  {
    const raw = recordedPool(), a = admission(raw);
    try {
      for (let i = 0; i < 8; i++) {
        const c = await a.pool.connect();
        c.release(new Error('synthetic uncertain history'));
        await gone(observer, raw.records[i]!.pid);
        counts(a, 0, i + 1);
      }
      const before = raw.counts().connects;
      await rejected(() => a.pool.connect());
      assert.equal(raw.counts().connects, before);
      assert.equal(createLocalModeSessionAdmission(raw.pool), a);
      counts(a, 0, 8);
      assert.equal((await a.close()).driverEnd, 'fulfilled');
      counts(a, 0, 8, false);
      assert.equal(raw.counts().ends, 1);
    } finally { raw.cleanup(); await a.close(); }
    pass('eight actual disposed histories exhaust lifetime admission without ninth native connect');
  }
  assert.equal(cases, 8, 'exact native scenario count');
} catch {
  faulted = true;
} finally {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      Promise.allSettled(cleanups.slice().reverse().map(cleanup => cleanup())),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 12000); }),
    ]);
    if (!settled || settled.some(result => result.status === 'rejected')) faulted = true;
  } finally { if (timer) clearTimeout(timer); }
  process.removeListener('unhandledRejection', error);
  process.removeListener('warning', warning);
}

if (faulted) throw Error('NATIVE_ADMISSION_FAILED');
console.log(`PASS native admission suite ${cases} groups`);
