import {render,screen,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {HostedInstallationFlow} from './App';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const denial=(code:string)=>new Response(JSON.stringify({ok:false,code}),{status:422});
it.each(['/journey/flow/'+id,'/checkout/journey/flow/'+id])('dispatches explicit V8 route %s without consuming a legacy session',async pathname=>{
 vi.resetModules();vi.stubGlobal('location',{protocol:'https:',pathname});vi.stubEnv('BASE_URL','/');vi.stubEnv('VITE_RUNTIME_ENV','staging');vi.stubEnv('VITE_RUNTIME_MODE','supabase');vi.stubEnv('VITE_SUPABASE_URL','https://child.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_stagingpublic');vi.stubEnv('VITE_TENANT_ID',id);vi.stubEnv('VITE_FLOW_API_URL','https://api.example');
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const App=(await import('./App')).default;render(<App/>);
 expect(await screen.findByRole('button',{name:'Open booking form'})).toBeVisible();expect(screen.getByText(/Staging · TEST payments only\. No real money is collected\./)).toBeVisible();expect(fetcher).not.toHaveBeenCalled();expect(screen.queryByText('Detailing quote')).toBeNull();
});
it('announces delayed Journey route loading without issuing a session before the chunk arrives',async()=>{
 vi.resetModules();let finish!:()=>void;const pending=new Promise<void>(resolve=>finish=resolve);vi.doMock('./flows/HostedJourneyFlow',async()=>{await pending;return vi.importActual('./flows/HostedJourneyFlow');});
 vi.stubGlobal('location',{protocol:'https:',pathname:'/journey/flow/'+id});vi.stubEnv('BASE_URL','/');vi.stubEnv('VITE_RUNTIME_ENV','staging');vi.stubEnv('VITE_RUNTIME_MODE','supabase');vi.stubEnv('VITE_SUPABASE_URL','https://child.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_stagingpublic');vi.stubEnv('VITE_TENANT_ID',id);vi.stubEnv('VITE_FLOW_API_URL','https://api.example');
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const App=(await import('./App')).default;render(<App/>);expect(screen.getByRole('status')).toHaveTextContent('Loading checkout');expect(fetcher).not.toHaveBeenCalled();finish();expect(await screen.findByRole('button',{name:'Open booking form'})).toBeVisible();expect(fetcher).not.toHaveBeenCalled();
});
it('fails safely on a missing Journey route chunk without replaying any session or claiming booking status',async()=>{
 vi.resetModules();vi.doMock('./flows/HostedJourneyFlow',()=>{throw Error('private journey chunk diagnostic');});vi.stubGlobal('location',{protocol:'https:',pathname:'/journey/flow/'+id});vi.stubEnv('BASE_URL','/');
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const App=(await import('./App')).default;render(<App/>);const alert=await screen.findByRole('alert');expect(alert).toHaveTextContent('Booking and payment status have not been checked');expect(alert.textContent).not.toContain('private journey chunk diagnostic');expect(screen.queryByRole('button')).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it.each(['missing-config','production'])('keeps the Journey route unavailable for %s without starting a legacy session',async kind=>{
 vi.resetModules();vi.stubGlobal('location',{protocol:'https:',pathname:'/journey/flow/'+id});vi.stubEnv('BASE_URL','/');vi.stubEnv('VITE_RUNTIME_ENV',kind==='production'?'production':'staging');vi.stubEnv('VITE_RUNTIME_MODE','supabase');vi.stubEnv('VITE_SUPABASE_URL','https://child.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',kind==='missing-config'?'':'sb_publishable_stagingpublic');vi.stubEnv('VITE_TENANT_ID',id);vi.stubEnv('VITE_FLOW_API_URL','https://api.example');
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const App=(await import('./App')).default;render(<App/>);expect(await screen.findByRole('alert')).toHaveTextContent('configuration could not be verified');expect(fetcher).not.toHaveBeenCalled();expect(screen.queryByRole('button')).toBeNull();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.doUnmock('./flows/HostedDetailingFlow');vi.doUnmock('./flows/HostedJourneyFlow');vi.doUnmock('./connected/ConnectedCheckout');vi.restoreAllMocks();});
it('routes a typed unsupported legacy issuer result to the dedicated Detailing session only',async()=>{vi.stubGlobal('location',{protocol:'https:'});const fetcher=vi.fn(async(url:string)=>denial(url.includes('/detailing-installations/')?'NOT_AVAILABLE':'UNSUPPORTED_CONFIG'));vi.stubGlobal('fetch',fetcher);render(<HostedInstallationFlow installationId={id} apiUrl="https://api.example"/>);await screen.findByText('Detailing quote');await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(fetcher.mock.calls.map(([u])=>u)).toEqual(['https://api.example/api/installations/'+id+'/sessions','https://api.example/api/detailing-installations/'+id+'/sessions']);});
it.each(['UNAUTHENTICATED','FORBIDDEN','INVALID_REQUEST','CONFLICT','NOT_AVAILABLE','INTERNAL_ERROR','RATE_LIMITED','UNKNOWN','network','malformed','schema7success'])('does not fall back on %s',async code=>{vi.stubGlobal('location',{protocol:'https:'});const fetcher=vi.fn(async()=>{if(code==='network')throw Error('private transport detail');if(code==='malformed')return new Response('{}');if(code==='schema7success')return new Response(JSON.stringify({ok:true,data:{sessionToken:'t'.repeat(43),expiresAt:'2035-01-01T00:00:00Z',render:{renderSchemaVersion:7}}}));return denial(code);});vi.stubGlobal('fetch',fetcher);render(<HostedInstallationFlow installationId={id} apiUrl="https://api.example"/>);await screen.findByRole('alert');expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.queryByText('Detailing quote')).toBeNull();expect(document.body.textContent).not.toContain('private transport detail');});
it('never switches a replacement installation on a late unsupported result',async()=>{vi.stubGlobal('location',{protocol:'https:'});let finish!:(r:Response)=>void;const fetcher=vi.fn(async(url:string)=>url.includes(id)?new Promise<Response>(resolve=>finish=resolve):denial('FORBIDDEN'));vi.stubGlobal('fetch',fetcher);const view=render(<HostedInstallationFlow key={id} installationId={id} apiUrl="https://api.example"/>);await waitFor(()=>expect(finish).toBeTypeOf('function'));view.rerender(<HostedInstallationFlow key={other} installationId={other} apiUrl="https://api.example"/>);await screen.findByRole('alert');finish(denial('UNSUPPORTED_CONFIG'));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(screen.queryByText('Detailing quote')).toBeNull();});
it('never switches a replacement client on a late unsupported result',async()=>{vi.stubGlobal('location',{protocol:'https:'});let finish!:(r:Response)=>void;const fetcher=vi.fn(async(url:string)=>url.startsWith('https://api.example/')?new Promise<Response>(resolve=>finish=resolve):denial('FORBIDDEN'));vi.stubGlobal('fetch',fetcher);const view=render(<HostedInstallationFlow installationId={id} apiUrl="https://api.example"/>);await waitFor(()=>expect(finish).toBeTypeOf('function'));view.rerender(<HostedInstallationFlow installationId={id} apiUrl="https://other.example"/>);await screen.findByRole('alert');finish(denial('UNSUPPORTED_CONFIG'));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(screen.queryByText('Detailing quote')).toBeNull();});

it('announces delayed Detailing route loading without starting a session or payment before the chunk arrives', async () => {
  vi.resetModules();
  let finish!: () => void;
  const loaded = new Promise<void>(resolve => { finish = resolve; });
  vi.doMock('./flows/HostedDetailingFlow', async () => {
    await loaded;
    return vi.importActual('./flows/HostedDetailingFlow');
  });
  const { HostedInstallationFlow: IsolatedFlow } = await import('./App');
  vi.stubGlobal('location', { protocol: 'https:' });
  const fetcher = vi.fn(async (url: string) => denial(url.includes('/detailing-installations/') ? 'NOT_AVAILABLE' : 'UNSUPPORTED_CONFIG'));
  vi.stubGlobal('fetch', fetcher);
  render(<IsolatedFlow installationId={id} apiUrl="https://api.example" />);
  const status = await screen.findByText('Loading checkout…');
  expect(status).toHaveAttribute('role', 'status');
  expect(status).toHaveTextContent('Loading checkout…');
  expect(status.closest('main')).toHaveAttribute('aria-busy', 'true');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Detailing quote')).toBeNull();
  finish();
  await screen.findByText('Detailing quote');
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://api.example/api/installations/' + id + '/sessions',
    'https://api.example/api/detailing-installations/' + id + '/sessions',
  ]);
  expect(screen.queryByText('Loading checkout…')).toBeNull();
});

it('reports a failed Detailing chunk without demo fallback, session replay, or a money claim', async () => {
  vi.resetModules();
  vi.doMock('./flows/HostedDetailingFlow', () => { throw Error('private chunk diagnostic'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { HostedInstallationFlow: IsolatedFlow } = await import('./App');
  vi.stubGlobal('location', { protocol: 'https:' });
  const fetcher = vi.fn(async () => denial('UNSUPPORTED_CONFIG'));
  vi.stubGlobal('fetch', fetcher);
  render(<IsolatedFlow installationId={id} apiUrl="https://api.example" />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Checkout could not be loaded');
  expect(alert).toHaveTextContent('Booking and payment status have not been checked');
  expect(alert).toHaveTextContent('contact the business with your booking reference before starting another booking');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toMatch(/Nothing has been charged|private chunk diagnostic/);
  expect(screen.queryByText('Detailing quote')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('loads connected checkout only after its accessible loading state, without falling back to demo', async () => {
  vi.resetModules();
  let finish!: () => void;
  const loaded = new Promise<void>(resolve => { finish = resolve; });
  vi.doMock('./connected/ConnectedCheckout', async () => {
    await loaded;
    return vi.importActual('./connected/ConnectedCheckout');
  });
  vi.stubEnv('VITE_RUNTIME_MODE', 'supabase');
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  vi.stubEnv('VITE_TENANT_ID', '');
  vi.stubGlobal('location', { protocol: 'https:', pathname: '/checkout/' });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { default: IsolatedApp } = await import('./App');
  render(<IsolatedApp />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading checkout…');
  expect(fetcher).not.toHaveBeenCalled();
  finish();
  await screen.findByText('Connected mode configuration is missing or invalid.');
  expect(screen.getByRole('heading', { name: 'Request a service' })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Checkout progress' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps a failed connected route neutral without opening a demo checkout or making network requests', async () => {
  vi.resetModules();
  vi.doMock('./connected/ConnectedCheckout', () => { throw Error('private connected chunk diagnostic'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('VITE_RUNTIME_MODE', 'supabase');
  vi.stubGlobal('location', { protocol: 'https:', pathname: '/checkout/' });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { default: IsolatedApp } = await import('./App');
  render(<IsolatedApp />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Checkout could not be loaded');
  expect(alert).toHaveTextContent('Booking and payment status have not been checked');
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toMatch(/Nothing has been charged|private connected chunk diagnostic/);
  expect(screen.queryByRole('navigation', { name: 'Checkout progress' })).toBeNull();
});
