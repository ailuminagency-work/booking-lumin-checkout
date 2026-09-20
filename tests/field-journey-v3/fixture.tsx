import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom';
import { createFieldDraftV3Client } from '../../packages/flow-ui/src/fieldDraftV3Client';
import { LocalFieldDraftV3Host, LocalFieldDraftV3Route, useLocalFieldDraftV3Context } from '../../apps/portal/src/flows/LocalFieldDraftV3Host';
interface Config { apiUrl: string; tenantA: string; tenantB: string; flowA: string; flowB: string; ownerAToken: string; ownerBToken: string; staffToken: string }
declare global { interface Window { __fieldJourney?: Config; __fieldJourneyProbe?: { saveAsStaff(): Promise<string> } } }
const config = window.__fieldJourney;
if (location.origin !== 'http://127.0.0.1:4193' || !config || new URL(config.apiUrl).hostname !== '127.0.0.1' || new URL(config.apiUrl).protocol !== 'http:') {
  document.getElementById('root')!.textContent = 'Local journey configuration required.';
} else {
  const settings = config, client = createFieldDraftV3Client(settings.apiUrl, true, fetch, true);
  window.__fieldJourneyProbe = { async saveAsStaff() {
    try { await client.save(settings.staffToken, settings.tenantA, settings.flowA, {fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:3,expectedFlowRevision:2,definition:{schemaVersion:3,fields:[]}}); return 'UNEXPECTED_SUCCESS'; }
    catch(error) { return error && typeof error==='object' && 'code' in error && error.code==='FORBIDDEN' ? 'FORBIDDEN' : 'UNEXPECTED_ERROR'; }
  } };
  let changeIdentity = (_value: string) => {}, changeFlow = (_value: string) => {}, changeParent = (_value: number) => {}, changeParentDirty = (_value: boolean) => {};
  function Editor() {
    const host = useLocalFieldDraftV3Context();
    return <><nav aria-label="Synthetic journey controls">
      <label>Test identity<select value={host.props.token === settings.ownerAToken ? 'ownerA' : host.props.token === settings.ownerBToken ? 'ownerB' : 'staff'} onChange={event => { const value = event.target.value; host.requestChange(() => changeIdentity(value)); }}>
        <option value="ownerA">Owner A</option><option value="ownerB">Owner B</option><option value="staff">Staff A</option>
      </select></label>
      <label>Test flow<select value={host.props.flowId === settings.flowA ? 'A' : 'B'} onChange={event => { const value = event.target.value; host.requestChange(() => changeFlow(value)); }}><option value="A">Flow A</option><option value="B">Flow B</option></select></label>
      <label>Parent revision<input type="number" min="1" value={host.props.parentRevision} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value > 0) changeParent(value); }} /></label>
      <label>Parent dirty<input type="checkbox" checked={host.props.parentDirty} onChange={event=>changeParentDirty(event.target.checked)}/></label>
      <Link to="/other">Other route</Link><Link to="/edit?view=choices#preview">Change route query</Link>
    </nav><LocalFieldDraftV3Route /></>;
  }
  function Host() {
    const [identity, setIdentity] = useState('ownerA'), [flow, setFlow] = useState('A'), [parent, setParent] = useState(1), [parentDirty, setParentDirty] = useState(false);
    useLayoutEffect(() => { changeIdentity = setIdentity; changeFlow = setFlow; changeParent = setParent; changeParentDirty = setParentDirty; return () => { changeIdentity = () => {}; changeFlow = () => {}; changeParent = () => {}; changeParentDirty = () => {}; }; }, []);
    return <LocalFieldDraftV3Host client={client} token={identity === 'ownerA' ? settings.ownerAToken : identity === 'ownerB' ? settings.ownerBToken : settings.staffToken}
      tenant={identity === 'ownerB' ? settings.tenantB : settings.tenantA} flowId={flow === 'A' ? settings.flowA : settings.flowB} parentRevision={parent} parentDirty={parentDirty} enabled confirmDiscard={() => window.confirm('Discard unsaved questions?')} />;
  }
  const router = createBrowserRouter([{ path: '/', element: <Host />, children: [{ path: 'edit', element: <Editor /> },{path:'other',element:<><p>Other static route</p><Link to='/edit'>Return to editor</Link></>}] }]);
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
}
