import { startTransition, Suspense, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useTextNavigationGuard } from './TextNavigationGuard';
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); vi.restoreAllMocks(); });
it.each(['dirty', 'busy'] as const)('retains committed %s guard during a suspended clean transition', async kind => {
 const confirm = vi.fn(() => false), action = vi.fn(), suspended = new Promise<void>(() => {});
 let proposeClean!: () => void;
 function Descendant({ clean }: { clean: boolean }) { if (clean) throw suspended; return <span>Committed editor</span>; }
 function Host() {
  const [clean, setClean] = useState(false); proposeClean = () => startTransition(() => setClean(true));
  const guard = useTextNavigationGuard({ dirty: kind === 'dirty' && !clean, busy: kind === 'busy' && !clean }, confirm);
  return <><button onClick={() => guard.requestChange(action)}>Leave context</button><Descendant clean={clean} /></>;
 }
 const router = createMemoryRouter([{ path: '*', element: <Suspense fallback={<span>Loading</span>}><Host /></Suspense> }], { initialEntries: ['/edit'] });
 routers.push(router); render(<RouterProvider router={router} />);
 await act(async () => proposeClean()); expect(screen.getByText('Committed editor')).toBeVisible();
 fireEvent.click(screen.getByText('Leave context')); expect(action).not.toHaveBeenCalled();
 await act(async () => { await router.navigate('/other'); }); expect(router.state.location.pathname).toBe('/edit');
 expect(confirm).toHaveBeenCalledTimes(kind === 'dirty' ? 2 : 0);
});
function setup() {
 let state = { dirty: false, busy: false }; let confirm = vi.fn(() => false); const action = vi.fn();
 let refresh!: () => void; let request!: (action: () => void) => boolean;
 function Host() { const [, setTick] = useState(0); refresh = () => setTick(v => v + 1); const guard = useTextNavigationGuard(state, confirm); request = guard.requestChange; return <button onClick={() => guard.requestChange(action)}>Change account</button>; }
 const router = createMemoryRouter([{ path: '*', element: <Host /> }], { initialEntries: ['/earlier', '/edit'], initialIndex: 1 });
 routers.push(router);
 const view = render(<RouterProvider router={router} />);
 return { state, replaceState(next: typeof state) { state = next; }, action, router, view, confirm, request(action: () => void) { return request(action); }, replaceConfirm(next: typeof confirm) { confirm = next; }, update() { act(() => refresh()); }, async navigate(to: string | number, replace = false) { await act(async () => { if (typeof to === 'number') await router.navigate(to); else await router.navigate(to, { replace }); }); } };
}
it.each(['push', 'replace', 'pop'] as const)('confirms dirty %s once, cancel retains and accept transitions', async kind => {
 const s = setup(); s.state.dirty = true; s.update();
 const go = () => s.navigate(kind === 'pop' ? -1 : '/next', kind === 'replace');
 await go(); expect(s.router.state.location.pathname).toBe('/edit'); expect(s.confirm).toHaveBeenCalledTimes(1);
 s.confirm.mockReturnValue(true); await go(); expect(s.router.state.location.pathname).toBe(kind === 'pop' ? '/earlier' : '/next'); expect(s.confirm).toHaveBeenCalledTimes(2);
});
it('denies busy even clean and never replays rejected destinations when settled', async () => {
 const s = setup(); s.state.busy = true; s.update(); await s.navigate('/one'); await s.navigate('/two', true);
 fireEvent.click(screen.getByText('Change account')); expect(s.action).not.toHaveBeenCalled(); expect(s.confirm).not.toHaveBeenCalled();
 s.state.busy = false; s.update(); expect(s.router.state.location.pathname).toBe('/edit'); await s.navigate('/three'); expect(s.router.state.location.pathname).toBe('/three');
});
it('uses replacement confirmation, guards search/hash and executes internal action once', async () => {
 const s = setup(); s.state.dirty = true; s.update(); await s.navigate('/edit?tab=x#detail'); expect(s.router.state.location.search).toBe('');
 const replacement = vi.fn(() => true); s.replaceConfirm(replacement); s.update(); fireEvent.click(screen.getByText('Change account'));
 expect(replacement).toHaveBeenCalledTimes(1); expect(s.action).toHaveBeenCalledTimes(1); expect(s.state.dirty).toBe(true);
 await s.navigate('/edit?tab=x#detail'); expect(s.router.state.location.hash).toBe('#detail'); expect(replacement).toHaveBeenCalledTimes(2);
});
it('beforeunload warns only while dirty or busy and cleans up on unmount', () => {
 const s = setup(); const event = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
 expect(event()).toBe(false); s.state.dirty = true; s.update(); expect(event()).toBe(true);
 s.state.dirty = false; s.state.busy = true; s.update(); expect(event()).toBe(true);
 s.view.unmount(); expect(event()).toBe(false);
});
it('does not retry thrown internal actions or act if confirmation makes state busy', () => {
 const s = setup(); const throws = vi.fn(() => { throw Error('action failed'); });
 expect(() => s.request(throws)).toThrow('action failed'); expect(throws).toHaveBeenCalledTimes(1);
 s.state.dirty = true; s.replaceConfirm(vi.fn(() => { s.state.busy = true; s.update(); return true; })); s.update();
 expect(s.request(s.action)).toBe(false); expect(s.action).not.toHaveBeenCalled();
});
it('denies a reentrant request during confirmation without another prompt', () => {
 const s = setup(); s.state.dirty = true;
 const confirm = vi.fn(() => { expect(s.request(s.action)).toBe(false); return true; });
 s.replaceConfirm(confirm); s.update(); expect(s.request(s.action)).toBe(true);
 expect(confirm).toHaveBeenCalledTimes(1); expect(s.action).toHaveBeenCalledTimes(1);
});
it('observes immutable state replacement and new confirmation callback identity', async () => {
 const s = setup(); s.replaceState({ dirty: false, busy: true }); s.update(); await s.navigate('/blocked');
 expect(s.router.state.location.pathname).toBe('/edit'); expect(s.confirm).not.toHaveBeenCalled();
 s.replaceState({ dirty: true, busy: false }); const accept = vi.fn(() => true); s.replaceConfirm(accept); s.update();
 await s.navigate('/accepted'); expect(s.router.state.location.pathname).toBe('/accepted'); expect(accept).toHaveBeenCalledTimes(1);
 expect(s.confirm).not.toHaveBeenCalled();
 s.replaceState({ dirty: false, busy: false }); s.update();
 const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
});
