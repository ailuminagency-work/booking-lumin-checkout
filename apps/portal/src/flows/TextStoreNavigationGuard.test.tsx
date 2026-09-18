import { act, cleanup, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { createTextGuardStore } from './TextGuardStore';
import { useTextStoreNavigationGuard } from './TextStoreNavigationGuard';
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); });
it('same-stack busy report denies route and internal actions without React rendering', async () => {
 const store = createTextGuardStore(), scope = store.beginContext(), confirm = vi.fn(() => true), action = vi.fn();
 let request!: (action: () => void) => boolean;
 function Host() { request = useTextStoreNavigationGuard(store, confirm).requestChange; return null; }
 const router = createMemoryRouter([{ path: '*', element: <Host /> }], { initialEntries: ['/edit'] }); routers.push(router); const view = render(<RouterProvider router={router} />);
 await act(async () => { scope.report({ dirty: false, busy: true }); expect(request(action)).toBe(false); await router.navigate('/other'); });
 expect(router.state.location.pathname).toBe('/edit'); expect(confirm).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
 const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
 scope.report({ dirty: false, busy: false }); expect(request(action)).toBe(true); expect(action).toHaveBeenCalledTimes(1);
 view.unmount(); const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
});
it('reads dirty changes immediately and rechecks busy after confirmation', () => {
 const store = createTextGuardStore(), scope = store.beginContext(), action = vi.fn();
 const confirm = vi.fn(() => { scope.report({ dirty: true, busy: true }); return true; }); let request!: (action: () => void) => boolean;
 function Host() { request = useTextStoreNavigationGuard(store, confirm).requestChange; return null; }
 const router = createMemoryRouter([{ path: '*', element: <Host /> }]); routers.push(router); render(<RouterProvider router={router} />);
 scope.report({ dirty: true, busy: false }); expect(request(action)).toBe(false); expect(action).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledTimes(1);
});
