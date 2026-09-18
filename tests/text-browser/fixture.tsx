import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
import { parseTextFieldDraftSave, type TextFieldDraftReceipt } from '../../packages/workflow/src/textFieldDraft';
import type { TextFieldDraftClient } from '../../packages/flow-ui/src/textFieldDraftClient';
import { LocalTextEditorHost, LocalTextEditorRoute, useLocalTextEditorContext } from '../../apps/portal/src/flows/LocalTextEditorHost';

type Kind = 'read' | 'save';
interface FixtureControl {
  setDeferred(kind: Kind, value: boolean): void;
  resolveNext(kind: Kind): void;
  switchAccount(): void;
  setParentRevision(value: number): void;
  snapshot(): { reads: number; saves: number; invalidations: number; pendingReads: number; pendingSaves: number };
}
declare global { interface Window { __textFixture?: FixtureControl } }

// This entry is never imported by the application. It has no real transport or credentials.
if (location.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  document.getElementById('root')!.textContent = 'This test fixture requires a loopback server.';
} else {
  const deferred = { read: false, save: false };
  const pending: Record<Kind, Array<() => void>> = { read: [], save: [] };
  const counts = { reads: 0, saves: 0, invalidations: 0 };
  const receipts = new Map<string, TextFieldDraftReceipt>();
  const seed = (): TextFieldDraftReceipt => ({ textDraftVersion: 1, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 4, currentParentRevision: 4,
    definition: { schemaVersion: 1, fields: [{ key: 'question_internal', kind: 'text', prompt: 'Saved question', required: false, minLength: 0, maxLength: 100 }] }, runtimePublishable: false, stale: false });
  function receipt(account: string) { if (!receipts.has(account)) receipts.set(account, seed()); return structuredClone(receipts.get(account)!); }
  function result<T>(kind: Kind, value: T): Promise<T> {
    if (!deferred[kind]) return Promise.resolve(value);
    if (pending[kind].length >= 8) return Promise.reject(new Error('Fixture pending limit'));
    return new Promise(resolve => pending[kind].push(() => resolve(value)));
  }
  const client: TextFieldDraftClient = {
    invalidate() { counts.invalidations++; }, // Deliberately let admitted mocks settle to test stale-response fencing.
    read(token) { counts.reads++; return result('read', { status: 'present' as const, receipt: receipt(token) }); },
    save(token, _tenant, _flow, input) {
      counts.saves++; const parsed = parseTextFieldDraftSave(input);
      const saved: TextFieldDraftReceipt = { ...receipt(token), draftRevision: parsed.expectedRevision + 1, savedParentRevision: parsed.expectedFlowRevision, currentParentRevision: parsed.expectedFlowRevision, definition: parsed.definition, stale: false };
      receipts.set(token, structuredClone(saved)); return result('save', saved);
    },
  };
  let switchAccount = () => {}, setRevision = (_value: number) => {};
  const controls: FixtureControl = {
    setDeferred(kind, value) { deferred[kind] = value; },
    resolveNext(kind) { pending[kind].shift()?.(); },
    switchAccount() { switchAccount(); },
    setParentRevision(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new Error('Invalid fixture revision'); setRevision(value); },
    snapshot() { return { ...counts, pendingReads: pending.read.length, pendingSaves: pending.save.length }; },
  };
  window.__textFixture = controls;
  function Controls() {
    const navigate = useNavigate(), host = useLocalTextEditorContext();
    return <nav aria-label="Browser test controls">
      <Link to="/other">Open other page</Link>{' '}<Link to="/edit">Open editor</Link>{' '}<Link to="/edit?view=2#questions">Change editor query</Link>
      <button onClick={() => void navigate('/other', { replace: true })}>Replace with other page</button>
      <button onClick={() => host.requestChange(controls.switchAccount)}>Guarded account switch</button>
      <button onClick={controls.switchAccount}>Force account switch</button>
      <button onClick={() => controls.setParentRevision(host.props.parentRevision + 1)}>Advance parent revision</button>
      <label><input type="checkbox" defaultChecked={deferred.read} onChange={event => controls.setDeferred('read', event.target.checked)} />Defer reads</label>
      <label><input type="checkbox" defaultChecked={deferred.save} onChange={event => controls.setDeferred('save', event.target.checked)} />Defer saves</label>
      <button onClick={() => controls.resolveNext('read')}>Resolve next read</button>
      <button onClick={() => controls.resolveNext('save')}>Resolve next save</button>
    </nav>;
  }
  function Editor() { return <><Controls /><LocalTextEditorRoute /></>; }
  function Other() { return <><Controls /><h2>Other page</h2></>; }
  function Host() {
    const [account, setAccount] = useState(0), [revision, updateRevision] = useState(4);
    useEffect(() => { switchAccount = () => setAccount(value => value + 1); setRevision = updateRevision; return () => { switchAccount = () => {}; setRevision = () => {}; }; }, []);
    return <LocalTextEditorHost client={client} token={`synthetic-owner-${account}`} tenant="11111111-1111-4111-8111-111111111111" flowId="22222222-2222-4222-8222-222222222222" parentRevision={revision} enabled confirmDiscard={() => window.confirm('Discard unsaved text questions?')} />;
  }
  const router = createBrowserRouter([{ path: '/', element: <Host />, children: [{ path: 'edit', element: <Editor /> }, { path: 'other', element: <Other /> }] }]);
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
}
