import { afterEach, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import * as FlowEditors from './FlowPortal';
import type { ModeEditorAdapter } from '../../../../packages/flow-ui/src/modeOwnerTypes';
import { ModeOwnerPortal } from './ModeOwnerPortal';
const tenant = '11111111-1111-4111-8111-111111111111', flow = '22222222-2222-4222-8222-222222222222', version = '33333333-3333-4333-8333-333333333333';
const token = 'synthetic-owner-credential';
const service = { id: tenant, name: 'Cleaning', durationMinutes: 30, questions: [{ id: 'q', prompt: 'Quantity', kind: 'quantity', required: true, choices: [], minQty: 1, maxQty: 10 }] };
const config = { key: 'request', steps: [{ key: 'q', questionKey: 'q', kind: 'question', required: true }] };
const profile = { schemaVersion: 1, profile: { profileVersion: 'local-owner', rendererOrigin: 'https://renderer.example', apiOrigin: 'https://api.example', portalOrigin: 'https://portal.example', loaderUrl: 'https://renderer.example/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' }, deliveryEnabled: false };
const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const result = (data: unknown) => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'completed', delivery: 'data', data } }));
const history = { schemaVersion: 1, requests: [], nextCursor: null };
function fixture(mutation?: (path: string, body: any) => Promise<Response>) {
    let published = version;
    const calls: {
        url: string;
        body: any;
    }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = String(input), body = options?.body ? JSON.parse(options.body as string) : null;
        calls.push({ url, body });
        if (url.includes('/api/local/mode-owner/')) {
            const path = url.split('/').at(-1)!;
            if (path === 'profile')
                return new Response(JSON.stringify(profile));
            if (path === 'request-history')
                return result(history);
            if (path === 'installations')
                return result({ installations: [], nextCursor: null });
            if (mutation)
                return mutation(path, body);
            return result({});
        }
        if (url.includes('/services'))
            return reply({ services: [service] });
        if (url.includes('/draft')) {
            if (options?.method === 'POST')
                return reply({ flowId: flow, revision: 2 });
            return reply({ flowId: flow, name: 'Cleaning form', revision: 1, serviceId: tenant, config, service });
        }
        return reply({ flows: [{ flowId: flow, name: 'Cleaning form', revision: 1, status: 'draft', serviceId: tenant, publishedVersionId: published }] });
    });
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:5174', protocol: 'http:', hostname: '127.0.0.1' });
    vi.stubGlobal('fetch', fetcher);
    return { calls, setPublished: (v: string) => { published = v; } };
}
async function login(credential = token, business = tenant) { fireEvent.change(screen.getByLabelText('Local test credential'), { target: { value: credential } }); fireEvent.change(screen.getByLabelText('Business ID'), { target: { value: business } }); fireEvent.click(screen.getByRole('button', { name: 'Open business' })); await screen.findByRole('button', { name: 'New questionnaire' }); }
function mount() { return render(<MemoryRouter initialEntries={['/embed']}><ModeOwnerPortal ownerApiUrl="http://127.0.0.1:8787" draftApiUrl="http://127.0.0.1:8788"/></MemoryRouter>); }
async function select() { fireEvent.change(screen.getByLabelText('Saved questionnaire'), { target: { value: flow } }); await waitFor(() => expect(screen.getByLabelText('Questionnaire name')).toHaveValue('Cleaning form')); await screen.findByText('No installations found.'); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('bootstraps one connected mode without legacy request calls or live links', async () => { const f = fixture(); mount(); await login(); await select(); expect(f.calls.some(c => c.url.includes('/api/requests'))).toBe(false); expect(f.calls.some(c => c.url.includes('/configurable-flows'))).toBe(true); expect(screen.queryByLabelText('Customer site origin (HTTPS)')).toBeNull(); expect(screen.queryByText('Open hosted request form')).toBeNull(); expect(screen.getAllByText(/Customer delivery not enabled/).length).toBeGreaterThan(0); });
it('dirty draft disables publish but permits explicit installation of current published version', async () => { const bodies: any[] = []; fixture(async (path, body) => { bodies.push({ path, body }); return new Response('lost', { status: 500 }); }); mount(); await login(); await select(); fireEvent.change(screen.getByLabelText('Questionnaire name'), { target: { value: 'Unsaved later draft' } }); expect(screen.getByRole('button', { name: 'Publish saved version' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Create installation' })).not.toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Create installation' })); await screen.findByText(/Change outcome unknown/); expect(bodies[0].path).toBe('install'); expect(bodies[0].body.versionId).toBe(version); expect(screen.getByDisplayValue('Unsaved later draft')).toBeTruthy(); });
it('delivery loss retains original key; absent recovery never unlocks or replays mutation', async () => { const calls: any[] = []; fixture(async (path, body) => { calls.push({ path, body }); return path === 'operation' ? new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'failed', code: 'UNAVAILABLE', transaction: 'rolled_back', backendMayStillRun: false } })) : new Response('truncated'); }); mount(); await login(); await select(); fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await screen.findByText(/Change outcome unknown/); fireEvent.click(screen.getByRole('button', { name: 'Check previous change' })); await screen.findByText(/An unavailable receipt/); expect(screen.getByRole('button', { name: 'Create installation' })).toBeDisabled(); expect(calls.map(x => x.path)).toEqual(['publish', 'operation']); expect(calls[1].body.idempotencyKey).toBe(calls[0].body.idempotencyKey); });
it('old committed delivery after logout cannot repopulate receipt or tenant controls', async () => { let deliver!: (r: Response) => void; fixture(async () => new Promise(r => deliver = r)); vi.spyOn(window, 'confirm').mockReturnValue(true); mount(); await login(); await select(); fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await waitFor(() => expect(deliver).toBeTypeOf('function')); fireEvent.click(screen.getByRole('button', { name: 'Sign out / change business' })); deliver(new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'committed', delivery: 'receipt', receipt: { schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: version, sourceRevision: 1, renderSchemaVersion: 1 } } }))); await screen.findByRole('button', { name: 'Open business' }); await Promise.resolve(); expect(screen.queryByText(/Historical receipt/)).toBeNull(); expect(screen.getByLabelText('Local test credential')).toHaveValue(''); });
it('complete committed receipt unlocks only after fresh authorized current state', async () => { fixture(async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'committed', delivery: 'receipt', receipt: { schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: version, sourceRevision: 1, renderSchemaVersion: 1 } } }))); mount(); await login(); await select(); fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await screen.findByText('Change recorded. Current settings refreshed.'); expect(screen.queryByRole('button', { name: 'Check previous change' })).toBeNull(); });
it('invalid or overlapping local endpoints fail closed with no requests', () => { const f = fixture(); render(<MemoryRouter><ModeOwnerPortal ownerApiUrl="http://127.0.0.1:8787" draftApiUrl="http://127.0.0.1:8787"/></MemoryRouter>); expect(screen.getByRole('alert')).toHaveTextContent('unavailable'); expect(f.calls).toHaveLength(0); });
it('refuses internal navigation when unsaved edits are not discarded', async () => { fixture(); vi.spyOn(window, 'confirm').mockReturnValue(false); mount(); await login(); await select(); fireEvent.change(screen.getByLabelText('Questionnaire name'), { target: { value: 'Keep these edits' } }); fireEvent.click(screen.getByRole('link', { name: 'Bookings' })); expect(screen.getByDisplayValue('Keep these edits')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Configurable questionnaires' })); expect(screen.getByDisplayValue('Keep these edits')).toBeTruthy(); });
it('bootstrapping failure never exposes partial business data or demo fallback', async () => { fixture(); const original = globalThis.fetch; vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => String(input).endsWith('/request-history') ? new Response('lost') : original(input, options)); mount(); fireEvent.change(screen.getByLabelText('Local test credential'), { target: { value: token } }); fireEvent.change(screen.getByLabelText('Business ID'), { target: { value: tenant } }); fireEvent.click(screen.getByRole('button', { name: 'Open business' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'New questionnaire' })).toBeNull(); expect(screen.queryByText('Cleaning')).toBeNull(); });
it('expires local recovery identity after30minutes without auto-unlocking; explicit abandon requires reload', async () => {
    const calls: any[] = [];
    fixture(async (path, body) => { calls.push({ path, body }); return new Response('lost'); });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await login();
    await select();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/Change outcome unknown/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1800000); });
    expect(screen.queryByRole('button', { name: 'Check previous change' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create installation' })).toBeDisabled();
    expect(calls).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue without resolving' })); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole('button', { name: 'Continue without resolving' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.idempotencyKey).not.toBe(calls[0].body.idempotencyKey);
});
it('historical recovery never replaces the fresh current published pointer', async () => {
    const newest = '55555555-5555-4555-8555-555555555555';
    const f = fixture(async (path) => path === 'publish' ? new Response('lost') : result({ schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: version, sourceRevision: 1, renderSchemaVersion: 1 }));
    mount();
    await login();
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' }));
    await screen.findByText(/Change outcome unknown/);
    f.setPublished(newest);
    fireEvent.click(screen.getByRole('button', { name: 'Check previous change' }));
    await screen.findByText('Change recorded. Current settings refreshed.');
    expect(screen.getByText('Published version: ' + newest)).toBeTruthy();
    expect(screen.queryByText('Published version: ' + version)).toBeNull();
});
it('recorded response plus failed refresh remains locked, with no new mutation replay', async () => {
    let dispatched = false;
    fixture(async () => { dispatched = true; return new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'committed', delivery: 'receipt', receipt: { schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: version, sourceRevision: 1, renderSchemaVersion: 1 } } })); });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => dispatched && String(input).endsWith('/installations') ? new Response('lost') : original(input, options));
    mount();
    await login();
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' }));
    await screen.findByText('Recorded; current settings unavailable.');
    expect(screen.getByRole('button', { name: 'Create installation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check previous change' })).toBeTruthy();
});
it('local key preparation failure never sends a mutation or claims unknown delivery', async () => { const f = fixture(); mount(); await login(); await select(); vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw Error('entropy unavailable'); }); fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' })); await screen.findByText('Unable to prepare the change. No request was sent.'); expect(f.calls.some(c => c.url.endsWith('/publish'))).toBe(false); expect(screen.queryByRole('button', { name: 'Check previous change' })).toBeNull(); vi.restoreAllMocks(); });

it('late rejected old mutation cannot set error or loading state in a newly signed-in tenant', async () => {
    let rejectOld!: (error: Error) => void;
    const f = fixture(async () => new Promise<Response>((_, reject) => { rejectOld = reject; }));
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
        mount(); await login(); await select();
        fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' }));
        await waitFor(() => expect(rejectOld).toBeTypeOf('function'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign out / change business' }));
        await login('synthetic-second-owner', version); await select();
        const callsBefore = f.calls.length;
        await act(async () => { rejectOld(Error('old tenant private failure')); await Promise.resolve(); });
        expect(f.calls).toHaveLength(callsBefore);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText(/Change outcome unknown|Historical receipt|Loading business settings/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Create installation' })).not.toBeDisabled();
        expect(screen.getByLabelText('Questionnaire name')).toHaveValue('Cleaning form');
    } finally { confirmation.mockRestore(); }
});

it('late old operation recovery cannot record history or refresh a new tenant', async () => {
    let deliver!: (response: Response) => void;
    const f = fixture(async path => path === 'publish' ? new Response('lost') : new Promise<Response>(resolve => { deliver = resolve; }));
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
        mount(); await login(); await select();
        fireEvent.click(screen.getByRole('button', { name: 'Publish saved version' }));
        await screen.findByText(/Change outcome unknown/);
        fireEvent.click(screen.getByRole('button', { name: 'Check previous change' }));
        await waitFor(() => expect(deliver).toBeTypeOf('function'));
        const original = f.calls.find(c => c.url.endsWith('/publish'))!;
        expect(f.calls.find(c => c.url.endsWith('/operation'))!.body.idempotencyKey).toBe(original.body.idempotencyKey);
        fireEvent.click(screen.getByRole('button', { name: 'Sign out / change business' }));
        await login('synthetic-second-owner', version); await select();
        const callsBefore = f.calls.length;
        await act(async () => { deliver(result({ schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: version, sourceRevision: 1, renderSchemaVersion: 1 })); await Promise.resolve(); });
        expect(f.calls).toHaveLength(callsBefore);
        expect(screen.queryByText(/Historical receipt|Change recorded/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Check previous change' })).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create installation' })).not.toBeDisabled();
    } finally { confirmation.mockRestore(); }
});

it('queued old editor adapter cannot dispatch with either credential after a new tenant login', async () => {
    let latest: ModeEditorAdapter | undefined;
    const Original = FlowEditors.VersionedEditor;
    const editor = vi.spyOn(FlowEditors, 'VersionedEditor').mockImplementation(props => {
        latest = props.modeAdapter;
        return createElement(Original, props);
    });
    const f = fixture(async () => new Response('lost'));
    const observed: { authorization: string | null; body: any }[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
        if (String(input).endsWith('/publish')) observed.push({ authorization: new Headers(options?.headers).get('Authorization'), body: JSON.parse(options?.body as string) });
        return originalFetch(input, options);
    });
    try {
        mount(); await login(); await select();
        const old = latest!;
        expect(old.active!()).toBe(true);
        let resume!: () => void;
        const queued = new Promise<void>(resolve => { resume = resolve; }).then(() => old.publish(flow, 1));
        fireEvent.click(screen.getByRole('button', { name: 'Sign out / change business' }));
        await login('synthetic-second-owner', version); await select();
        const fresh = latest!, before = f.calls.length;
        expect(old.active!()).toBe(false); expect(fresh.active!()).toBe(true);
        await act(async () => { resume(); await queued; await old.changed(); old.selection(flow, true); });
        expect(f.calls).toHaveLength(before); expect(observed).toEqual([]);
        expect(screen.getByRole('button', { name: 'Publish saved version' })).not.toBeDisabled();
        // Neighboring live adapter still dispatches once, using only the new tenant/credential.
        await act(async () => { await fresh.publish(flow, 1); });
        expect(observed).toHaveLength(1);
        expect(observed[0]!.authorization).toBe('Bearer synthetic-second-owner');
        expect(observed[0]!.body.tenantId).toBe(version);
    } finally { editor.mockRestore(); }
});