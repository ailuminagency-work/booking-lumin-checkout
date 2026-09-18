import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/** Mount one persistent host inside a data router; no competing blockers. Router
 * protection begins after its registration effects. Includes search/hash changes.
 * requestChange is for non-router actions only: do not wrap navigate() with it.
 * Never queues a denied action.
 * Consumes committed state only. The host must coordinate synchronous busy
 * admission: setState followed by navigate in the same stack is insufficient.
 * This is a navigation safeguard, not a request cancellation or persistence mechanism.
 */
export function useTextNavigationGuard(state: { dirty: boolean; busy: boolean }, confirmDiscard: () => boolean): { requestChange(action: () => void): boolean } {
  const latest = useRef({ state: { ...state }, confirmDiscard });
  useLayoutEffect(() => { latest.current = { state: { ...state }, confirmDiscard }; });
  const deciding = useRef(false);
  const allowed = useCallback(() => {
    if (deciding.current || latest.current.state.busy) return false;
    if (!latest.current.state.dirty) return true;
    deciding.current = true;
    try { return latest.current.confirmDiscard() && !latest.current.state.busy; }
    finally { deciding.current = false; }
  }, []);
  // Decide synchronously in the router predicate. Acceptance lets the original
  // navigation run once; rejection is reset, never saved for a later proceed().
  const blocker = useBlocker(useCallback(() => !allowed(), [allowed]));
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset(); }, [blocker]);
  useEffect(() => {
    if (!state.dirty && !state.busy) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!latest.current.state.dirty && !latest.current.state.busy) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [state.dirty, state.busy]);
  const requestChange = useCallback((action: () => void) => {
    if (!allowed()) return false;
    action(); return true;
  }, [allowed]);
  return { requestChange };
}
