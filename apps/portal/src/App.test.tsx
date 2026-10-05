import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {App,ErrorBoundary} from './App';

const fixtures=vi.hoisted(()=>({connected:vi.fn(),demo:vi.fn(),mode:'supabase'}));
vi.mock('@lumin/runtime-client',()=>({readPublicRuntimeConfig:()=>({mode:fixtures.mode,environment:'staging',supabaseUrl:'https://example.test',supabasePublishableKey:'public-fixture',tenantId:'tenant-fixture'})}));
vi.mock('./connected/ConnectedPortal',()=>({ConnectedPortal:()=>{fixtures.connected();throw Error('secret-like-customer-token');}}));
vi.mock('./components/PortalProvider',()=>({PortalProvider:()=>{fixtures.demo();return <p>Demo</p>;}}));
vi.mock('./components/PortalRoutes',()=>({LegacyRedirects:()=>null,PortalRoutes:()=>null}));
vi.mock('./flows/FlowPortal',()=>({FlowPortal:()=>null}));
vi.mock('./flows/ModeOwnerPortal',()=>({ModeOwnerPortal:()=>null}));
vi.mock('./components/Layout',()=>({Layout:()=>null}));
const suppressExpectedCrash=(event:ErrorEvent)=>event.preventDefault();
beforeEach(()=>window.addEventListener('error',suppressExpectedCrash));
afterEach(()=>{window.removeEventListener('error',suppressExpectedCrash);cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();fixtures.connected.mockClear();fixtures.demo.mockClear();});

it('logs only its fixed diagnostic code even when the error and component stack contain private data',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const boundary=new ErrorBoundary({children:null});
 // React supplies both arguments at runtime; exercise the real boundary hook, not React's own diagnostics.
 (boundary.componentDidCatch as (...args:unknown[])=>void)(new Error('secret-error-token'),{componentStack:'secret-stack-customer'});
 expect(log.mock.calls).toEqual([['PORTAL_RENDER_ERROR']]);
});

it('shows truthful recovery guidance and reloads without retrying the crashed action',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),action=vi.fn();
 function Crashed():never{action();throw Error('secret-render-payload');}
 render(<ErrorBoundary><Crashed/></ErrorBoundary>);
 const rendersBeforeRecovery=action.mock.calls.length;
 expect(screen.getByRole('alert')).toHaveTextContent('does not tell us whether your last action was saved');
 expect(screen.getByRole('alert')).toHaveTextContent('open the selected booking and check its current details before retrying');
 expect(document.body.textContent).not.toContain('secret-render-payload');
 // React/jsdom also report render failures; only the application's own fixed-code calls are controlled here.
 expect(log.mock.calls.filter(([first])=>first==='PORTAL_RENDER_ERROR')).toEqual([['PORTAL_RENDER_ERROR']]);
 fireEvent.click(screen.getByRole('button',{name:'Reload portal'}));
 expect(action).toHaveBeenCalledTimes(rendersBeforeRecovery);
 expect(screen.getByRole('alert')).toBeTruthy();
});

it('keeps a failing Supabase portal inside the boundary without mounting demo or replaying on recovery',()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.stubEnv('VITE_MODE_OWNER_LOCAL_HARNESS','false');vi.stubEnv('VITE_FLOW_LOCAL_HARNESS','false');
 render(<App/>);
 expect(fixtures.connected).toHaveBeenCalled();
 expect(fixtures.demo).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Reload portal'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Try again'})).toBeNull();
});
