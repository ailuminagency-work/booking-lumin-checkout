import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
import { parseFieldDraftSaveV2, type FieldDraftReceiptV2 } from '../../packages/workflow/src/fieldDraftV2';
import type { FieldDraftV2Client } from '../../packages/flow-ui/src/fieldDraftV2Client';
import { LocalFieldDraftV2Host, LocalFieldDraftV2Route, useLocalFieldDraftV2Context } from '../../apps/portal/src/flows/LocalFieldDraftV2Host';

type Kind = 'read' | 'save';
interface FixtureControl {
  setDeferred(kind: Kind, value: boolean): void;
  resolveNext(kind: Kind): void;
  switchAccount(): void;
  setParentRevision(value: number): void;
  setParentDirty(value: boolean): void;
  snapshot(): { reads: number; saves: number; invalidations: number; pendingReads: number; pendingSaves: number };
}
declare global { interface Window { __fieldFixture?: FixtureControl } }

// This entry is never imported by the application. It has no real transport or credentials.
if (location.origin !== 'http://127.0.0.1:4190') {
  document.getElementById('root')!.textContent = 'This test fixture requires a loopback server.';
} else {
  let currentParentRevision = 4;
  const deferred = { read: false, save: false };
  const pending: Record<Kind, Array<() => void>> = { read: [], save: [] };
  const counts = { reads: 0, saves: 0, invalidations: 0 };
  const receipts = new Map<string, FieldDraftReceiptV2>();
  const seed = (): FieldDraftReceiptV2 => ({ fieldDraftVersion: 2, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 4, currentParentRevision: 4,
    definition: { schemaVersion: 2, fields: [{ key: 'short_question', kind: 'text', prompt: 'Short question', required: true, minLength: 1, maxLength: 2 }, {key:'long_question',kind:'textarea',prompt:'Long question',required:false,minLength:0,maxLength:100}] }, runtimePublishable: false, stale: false });
  function receipt(account: string) { if (!receipts.has(account)) receipts.set(account, seed()); const value=structuredClone(receipts.get(account)!); return {...value,currentParentRevision,stale:value.savedParentRevision!==currentParentRevision}; }
  function result<T>(kind: Kind, value: T): Promise<T> {
    if (!deferred[kind]) return Promise.resolve(value);
    if (pending[kind].length >= 8) return Promise.reject(new Error('Fixture pending limit'));
    return new Promise(resolve => pending[kind].push(() => resolve(value)));
  }
  const client: FieldDraftV2Client = {
    invalidate() { counts.invalidations++; }, // Deliberately let admitted mocks settle to test stale-response fencing.
    read(token) { counts.reads++; return result('read', { status: 'present' as const, receipt: receipt(token) }); },
    save(token, _tenant, _flow, input) {
      counts.saves++; const parsed = parseFieldDraftSaveV2(input);
      const saved: FieldDraftReceiptV2 = { ...receipt(token), draftRevision: parsed.expectedRevision + 1, savedParentRevision: parsed.expectedFlowRevision, currentParentRevision: parsed.expectedFlowRevision, definition: parsed.definition, stale: false };
      receipts.set(token, structuredClone(saved)); return result('save', saved);
    },
  };
  let switchAccount = () => {}, setRevision = (_value: number) => {}, setDirty = (_value: boolean) => {};
  const controls: FixtureControl = {
    setDeferred(kind, value) { deferred[kind] = value; },
    resolveNext(kind) { pending[kind].shift()?.(); },
    switchAccount() { switchAccount(); },
    setParentRevision(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new Error('Invalid fixture revision'); currentParentRevision=value; setRevision(value); },
    setParentDirty(value) { if(typeof value!=='boolean') throw new Error('Invalid fixture flag'); setDirty(value); },
    snapshot() { return { ...counts, pendingReads: pending.read.length, pendingSaves: pending.save.length }; },
  };
  window.__fieldFixture = controls;
  function Controls() {
    const navigate = useNavigate(), host = useLocalFieldDraftV2Context();
    return <nav aria-label="Browser test controls">
      <Link to="/other">Open other page</Link>{' '}<Link to="/edit">Open editor</Link>{' '}<Link to="/edit?view=2#questions">Change editor query</Link>
      <button onClick={() => void navigate('/other', { replace: true })}>Replace with other page</button>
      <button onClick={() => host.requestChange(controls.switchAccount)}>Guarded account switch</button>
      <button onClick={controls.switchAccount}>Force account switch</button>
      <button onClick={() => controls.setParentRevision(host.props.parentRevision + 1)}>Advance parent revision</button>
      <label><input type="checkbox" checked={host.props.parentDirty} onChange={event=>controls.setParentDirty(event.target.checked)}/>Parent has unsaved changes</label>
      <label><input type="checkbox" defaultChecked={deferred.read} onChange={event => controls.setDeferred('read', event.target.checked)} />Defer reads</label>
      <label><input type="checkbox" defaultChecked={deferred.save} onChange={event => controls.setDeferred('save', event.target.checked)} />Defer saves</label>
      <button onClick={() => controls.resolveNext('read')}>Resolve next read</button>
      <button onClick={() => controls.resolveNext('save')}>Resolve next save</button>
    </nav>;
  }
  function Editor() { return <><Controls /><LocalFieldDraftV2Route /></>; }
  function Other() { return <><Controls /><h2>Other page</h2></>; }
  function Host() {
    const [account, setAccount] = useState(0), [revision, updateRevision] = useState(4), [parentDirty, updateDirty] = useState(false);
    useEffect(() => { switchAccount = () => setAccount(value => (value + 1) % 8); setRevision = updateRevision; setDirty = updateDirty; return () => { switchAccount = () => {}; setRevision = () => {}; setDirty = () => {}; }; }, []);
    return <LocalFieldDraftV2Host client={client} token={`synthetic-owner-${account}`} tenant="11111111-1111-4111-8111-111111111111" flowId="22222222-2222-4222-8222-222222222222" parentRevision={revision} parentDirty={parentDirty} enabled confirmDiscard={() => window.confirm('Discard unsaved questions?')} />;
  }
  const router = createBrowserRouter([{ path: '/', element: <Host />, children: [{ path: 'edit', element: <Editor /> }, { path: 'other', element: <Other /> }] }]);
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
}
