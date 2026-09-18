import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { createTextFieldDraftClient } from '../../packages/flow-ui/src/textFieldDraftClient';
import { LocalTextEditorHost, LocalTextEditorRoute, useLocalTextEditorContext } from '../../apps/portal/src/flows/LocalTextEditorHost';
interface Config { apiUrl: string; tenantA: string; tenantB: string; flowA: string; flowB: string; ownerAToken: string; ownerBToken: string; staffToken: string }
declare global { interface Window { __textJourney?: Config } }
const config = window.__textJourney;
if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || !config || new URL(config.apiUrl).hostname !== '127.0.0.1' || new URL(config.apiUrl).protocol !== 'http:') {
  document.getElementById('root')!.textContent = 'Local journey configuration required.';
} else {
  const settings = config, client = createTextFieldDraftClient(settings.apiUrl, true);
  let changeIdentity = (_value: string) => {}, changeFlow = (_value: string) => {}, changeParent = (_value: number) => {};
  function Editor() {
    const host = useLocalTextEditorContext();
    return <><nav aria-label="Synthetic journey controls">
      <label>Test identity<select value={host.props.token === settings.ownerAToken ? 'ownerA' : host.props.token === settings.ownerBToken ? 'ownerB' : 'staff'} onChange={event => { const value = event.target.value; host.requestChange(() => changeIdentity(value)); }}>
        <option value="ownerA">Owner A</option><option value="ownerB">Owner B</option><option value="staff">Staff A</option>
      </select></label>
      <label>Test flow<select value={host.props.flowId === settings.flowA ? 'A' : 'B'} onChange={event => { const value = event.target.value; host.requestChange(() => changeFlow(value)); }}><option value="A">Flow A</option><option value="B">Flow B</option></select></label>
      <label>Parent revision<input type="number" min="1" value={host.props.parentRevision} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value > 0) changeParent(value); }} /></label>
    </nav><LocalTextEditorRoute /></>;
  }
  function Host() {
    const [identity, setIdentity] = useState('ownerA'), [flow, setFlow] = useState('A'), [parent, setParent] = useState(1);
    useLayoutEffect(() => { changeIdentity = setIdentity; changeFlow = setFlow; changeParent = setParent; return () => { changeIdentity = () => {}; changeFlow = () => {}; changeParent = () => {}; }; }, []);
    return <LocalTextEditorHost client={client} token={identity === 'ownerA' ? settings.ownerAToken : identity === 'ownerB' ? settings.ownerBToken : settings.staffToken}
      tenant={identity === 'ownerB' ? settings.tenantB : settings.tenantA} flowId={flow === 'A' ? settings.flowA : settings.flowB} parentRevision={parent} enabled confirmDiscard={() => window.confirm('Discard unsaved text questions?')} />;
  }
  const router = createBrowserRouter([{ path: '/', element: <Host />, children: [{ path: 'edit', element: <Editor /> }] }]);
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
}
