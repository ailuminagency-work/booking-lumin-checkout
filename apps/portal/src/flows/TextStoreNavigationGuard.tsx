import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import type { createTextGuardStore } from './TextGuardStore';

/** One persistent data-router host, after registration effects. Non-router actions
 * only in requestChange; never wrap navigate. Store reports are synchronous authority.
 * This does not cancel database work or guarantee browser beforeunload delivery. */
export function useTextStoreNavigationGuard(store: ReturnType<typeof createTextGuardStore>, confirmDiscard: () => boolean) {
  const committed = useRef({ store, confirmDiscard });
  useLayoutEffect(() => { committed.current = { store, confirmDiscard }; });
  const deciding = useRef(false);
  const allowed = useCallback(() => {
    const source = committed.current;
    if (deciding.current || source.store.getSnapshot().busy) return false;
    if (!source.store.getSnapshot().dirty) return true;
    deciding.current = true;
    try { return source.confirmDiscard() && source === committed.current && !source.store.getSnapshot().busy; }
    finally { deciding.current = false; }
  }, []);
  const blocker = useBlocker(useCallback(() => !allowed(), [allowed]));
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset(); }, [blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const state = committed.current.store.getSnapshot();
      if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  return { requestChange: useCallback((action: () => void) => { if (!allowed()) return false; action(); return true; }, [allowed]) };
}
