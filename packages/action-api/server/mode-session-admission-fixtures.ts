/** Native driver observations only; raw objects stay inside this trusted fixture. */
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import type { ModeSessionClient, ModeSessionPool } from './mode-session-repository.js';
import { config, pid } from './mode-session-transport-fixtures.js';
export { config, setup, prepared, snapshot, holder, profile, issueRequest, blocked, gone, observe, pause, lossProxy } from './mode-session-transport-fixtures.js';

export type QueryHook = (client: PoolClient, text: string, run: () => Promise<any>) => Promise<any>;
export type Acquisition = {
  pid: number;
  releaseIdentity: PoolClient['release'];
  queries: number;
  pending: number;
  releases: number;
  badReleases: number;
  commands: string[];
  listeners(): { captured: number; attached: number; errorCount: number; endCount: number; baselineError: number; baselineEnd: number };
};
export function recordedPool(port?: number, hook?: QueryHook) {
  const real = new Pool({ ...config(), ...(port ? { port } : {}), max: 1, idleTimeoutMillis: 15000 });
  const connect = real.connect.bind(real), end = real.end.bind(real);
  const on = real.on.bind(real), remove = real.removeListener.bind(real);
  const records: Acquisition[] = [];
  const cleanupLeases: Array<() => void> = [];
  let connects = 0, ends = 0, endSettled = false;
  let ending: Promise<void> | undefined;
  const pool: ModeSessionPool = {
    async connect() {
      connects++;
      assert.ok(connects <= 32, 'bounded native acquisition observations');
      const c = await connect();
      const query = c.query.bind(c);
      // pg-pool assigns this closure anew on EVERY checkout, even for the same PID.
      const release = c.release;
      const clientOn = c.on.bind(c), clientRemove = c.removeListener.bind(c);
      const baselineError = c.listenerCount('error'), baselineEnd = c.listenerCount('end');
      const identities = new Map<Function, string>();
      const record: Acquisition = { listeners() {
        let attached = 0;
        for (const [fn, event] of identities) if (c.listeners(event).includes(fn as (...args: any[]) => void)) attached++;
        return { baselineError, baselineEnd, captured: identities.size, attached, errorCount: c.listenerCount('error'), endCount: c.listenerCount('end') };
      }, pid: pid(c), releaseIdentity: release, queries: 0, pending: 0, releases: 0, badReleases: 0, commands: [] };
      records.push(record);
      cleanupLeases.push(() => {
        if (record.releases === 0) {
          record.releases++; record.badReleases++;
          Reflect.apply(release, c, [new Error('fixture cleanup')]);
        }
      });
      const view: ModeSessionClient = {
        async query(text, values) {
          record.queries++;
          assert.ok(record.queries <= 64, 'bounded native command observations');
          record.pending++;
          record.commands.push(text);
          try {
            const run = () => query(text, values);
            return await (hook ? hook(c, text, run) : run());
          } finally { record.pending--; }
        },
        release(error) {
          record.releases++;
          if (error) record.badReleases++;
          Reflect.apply(release, c, [error]);
        },
        on(event, callback) {
          if (!identities.has(callback)) assert.ok(identities.size < 4, 'bounded captured listener identities');
          identities.set(callback, event);
          clientOn(event as 'error', callback); return view;
        },
        removeListener(event, callback) { clientRemove(event as 'error', callback); return view; },
      };
      return view;
    },
    end() {
      ends++;
      ending = end().then(() => { endSettled = true; }, error => { endSettled = true; throw error; });
      return ending;
    },
    on(event, callback) { on(event as 'error', callback); return pool; },
    removeListener(event, callback) { remove(event as 'error', callback); return pool; },
  };
  function cleanup() {
    let failed = false;
    for (const dispose of cleanupLeases) { try { dispose(); } catch { failed = true; } }
    if (failed) throw Error('NATIVE_CLEANUP_FAILED');
  }
  return { pool, records, counts: () => ({ connects, ends, endSettled }), cleanup, async shutdown() {
    let failed = false;
    try { cleanup(); } catch { failed = true; }
    // Fallback construction cleanup still calls the real driver end at most once.
    try { await (ending ?? pool.end()); } catch { failed = true; }
    if (failed) throw Error('NATIVE_CLEANUP_FAILED');
  } };
}

export async function terminal(client: ModeSessionClient) {
  assert.equal((await client.query('BEGIN')).command, 'BEGIN');
  assert.equal((await client.query('COMMIT')).command, 'COMMIT');
}
export async function rejected(action: () => unknown) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  assert.equal(failed, true, 'stale/denied operation rejects');
}
