export type TextGuardState = Readonly<{ dirty: boolean; busy: boolean }>;
export interface TextGuardContext {
  report(state: TextGuardState): void;
  invalidate(): void;
}
export interface TextGuardStore {
  getSnapshot(): TextGuardState;
  subscribe(listener: () => void): () => void;
  beginContext(): TextGuardContext;
  dispose(): void;
}
/** Component-local navigation authority. Reports replace the full state and are
 * accepted only from the current context. Listener failures are isolated without
 * logging potentially sensitive exception contents; snapshots remain authoritative.
 */
export function createTextGuardStore(): TextGuardStore {
  let snapshot: TextGuardState = Object.freeze({ dirty: false, busy: false });
  let generation = 0, disposed = false;
  const listeners = new Set<() => void>();
  function publish(dirty: boolean, busy: boolean) {
    if (snapshot.dirty === dirty && snapshot.busy === busy) return;
    snapshot = Object.freeze({ dirty, busy });
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(); } catch { /* One observer cannot suppress another observer. */ }
    }
  }
  function assertOpen() { if (disposed) throw new Error('TEXT_GUARD_DISPOSED'); }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      assertOpen(); listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    beginContext() {
      assertOpen(); const current = ++generation;
      publish(false, false);
      return Object.freeze({
        report(state: TextGuardState) {
          if (disposed || current !== generation) return;
          if (typeof state?.dirty !== 'boolean' || typeof state?.busy !== 'boolean') throw new Error('INVALID_TEXT_GUARD_STATE');
          publish(state.dirty, state.busy);
        },
        invalidate() {
          if (disposed || current !== generation) return;
          ++generation; publish(false, false);
        },
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true; ++generation;
      // A disposed authority cannot approve navigation or accept new contexts.
      publish(false, true); listeners.clear();
    },
  });
}
