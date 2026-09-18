import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { TextFieldDraftClient } from '../../../../packages/flow-ui/src/textFieldDraftClient';
import { LocalTextEditorHost, LocalTextEditorRoute } from './LocalTextEditorHost';
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); });
const receipt = { textDraftVersion: 1 as const, parentAuthoringVersion: 2 as const, draftRevision: 1, savedParentRevision: 4, currentParentRevision: 4, definition: { schemaVersion: 1 as const, fields: [{ key: 'internal', kind: 'text' as const, prompt: 'Saved question', required: false, minLength: 0, maxLength: 100 }] }, runtimePublishable: false as const, stale: false };
function setup(strict = false) {
 const client: TextFieldDraftClient = { invalidate: vi.fn(), read: vi.fn<TextFieldDraftClient['read']>().mockResolvedValue({ status: 'present', receipt }), save: vi.fn<TextFieldDraftClient['save']>().mockResolvedValue(receipt) };
 const confirm = vi.fn(() => false);
 let props = { client, token: 'owner-token-valid', tenant: '11111111-1111-4111-8111-111111111111', flowId: '22222222-2222-4222-8222-222222222222', parentRevision: 4, enabled: true, confirmDiscard: confirm };
 // Root element replacement via route patch is unnecessary: a wrapper takes current props on rerender.
 let refresh!: () => void;
 function Host() { const [, setTick] = useState(0); refresh = () => setTick(v => v + 1); return <LocalTextEditorHost {...props} />; }
 const router = createMemoryRouter([{ path: '/', element: <Host />, children: [{ path: 'edit', element: <LocalTextEditorRoute /> }, { path: 'other', element: <p>Other page</p> }] }], { initialEntries: ['/edit'] }); routers.push(router);
 const element = () => strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />;
 const view = render(element());
 return { client, confirm, router, view, update(change: Partial<typeof props>) { props = { ...props, ...change }; act(() => refresh()); }, async go(to: string | number) { await act(async () => { if (typeof to === 'number') await router.navigate(to); else await router.navigate(to); }); }, props };
}
async function load() { fireEvent.click(await screen.findByText('Load questions')); await screen.findByDisplayValue('Saved question'); }
it('dirty cancel retains draft; accept commits departure and back starts fresh', async () => {
 const s = setup(); await load(); fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Unsaved local' } });
 await s.go('/other'); expect(s.router.state.location.pathname).toBe('/edit'); expect(screen.getByDisplayValue('Unsaved local')).toBeVisible();
 s.confirm.mockReturnValue(true); await s.go('/other'); expect(screen.getByText('Other page')).toBeVisible(); expect(screen.getByText('No unsaved question changes.')).toBeVisible();
 await s.go(-1); expect(screen.queryByDisplayValue('Unsaved local')).toBeNull(); await load(); expect(screen.getByDisplayValue('Saved question')).toBeVisible();
});
it('actual editor read reports busy before client invocation can navigate', async () => {
 const s = setup(); let finish!: (value: { status: 'present'; receipt: typeof receipt }) => void;
 vi.mocked(s.client.read).mockImplementationOnce(() => { void s.router.navigate('/other'); return new Promise(resolve => { finish = resolve; }); });
 fireEvent.click(await screen.findByText('Load questions')); await waitFor(() => expect(s.client.read).toHaveBeenCalled());
 expect(s.router.state.location.pathname).toBe('/edit'); expect(s.confirm).not.toHaveBeenCalled();
 await act(async () => finish({ status: 'present', receipt })); expect(screen.getByDisplayValue('Saved question')).toBeVisible();
});
it('accepted search/hash change retires local draft and StrictMode remains usable', async () => {
 const s = setup(true); await load(); fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Discarded' } });
 s.confirm.mockReturnValue(true); await s.go('/edit?tab=2#questions'); expect(screen.queryByDisplayValue('Discarded')).toBeNull();
 expect(screen.getByText('Load questions')).toBeVisible(); expect(s.client.invalidate).toHaveBeenCalled();
});
it('forced account change hides old data and fences deferred settlement', async () => {
 const s = setup(); await load(); let finish!: (value: typeof receipt) => void;
 vi.mocked(s.client.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Old account' } }); fireEvent.click(screen.getByText('Save questions'));
 s.update({ token: 'new-account-token' }); expect(screen.queryByDisplayValue('Old account')).toBeNull(); expect(screen.getByText('Load questions')).toBeVisible();
 let finishNew!: (value: { status: 'present'; receipt: typeof receipt }) => void;
 vi.mocked(s.client.read).mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
 fireEvent.click(screen.getByText('Load questions'));
 await act(async () => finish(receipt)); expect(screen.queryByDisplayValue('Old account')).toBeNull(); expect(screen.getByText('Questions are loading or saving.')).toBeVisible();
 await s.go('/other'); expect(s.router.state.location.pathname).toBe('/edit'); expect(s.confirm).not.toHaveBeenCalled();
 await act(async () => finishNew({ status: 'present', receipt })); expect(screen.getByText('No unsaved question changes.')).toBeVisible();
 expect(s.client.invalidate).toHaveBeenCalled(); expect(s.client.read).toHaveBeenCalledTimes(2);
});
it('parent revision changes preserve unsaved question edits', async () => {
 const s = setup(); await load(); fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep revision edit' } });
 s.update({ parentRevision: 5 }); expect(screen.getByDisplayValue('Keep revision edit')).toBeVisible(); expect(screen.getByText('Save questions')).toBeDisabled();
});
