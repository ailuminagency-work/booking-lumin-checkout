import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {HostedJourneyFlow} from './HostedJourneyFlow';
import type {PublicRuntimeConfig} from '@lumin/runtime-client';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const config:PublicRuntimeConfig={mode:'supabase',environment:'staging',apiOrigin:'https://api.example',flowApiOrigin:'https://api.example',supabaseUrl:'https://child.supabase.co',supabasePublishableKey:'sb_publishable_stagingpublic',tenantId:id};
const journey=(informationFirst=false)=>({schemaVersion:1,stages:(informationFirst?['service','options','information','schedule','review_payment','confirmation']:['service','options','schedule','information','review_payment','confirmation']).map(kind=>({id:kind,kind,label:kind==='review_payment'?'Review & Payment':kind[0]!.toUpperCase()+kind.slice(1),enabled:kind!=='options'}))});
const session=(name='Published journey',informationFirst=false)=>({schemaVersion:1,sessionToken:'x'.repeat(43),expiresAt:new Date(Date.now()+10*60000).toISOString(),render:{versionId:id,renderSchemaVersion:8,submissionMode:'paid_journey_request',paymentMode:'staging_mock',simulated:true,service:{id,name:'Home cleaning',durationMinutes:30,price:{amount:5000,currency:'USD'}},form:{name,presentation:{accentColor:'#0f766e',layout:'compact'},journey:journey(informationFirst)}}});
const response=(data:unknown)=>new Response(JSON.stringify({ok:true,data}),{status:200});
const tomorrow=()=>new Date(Date.now()+86400000).toISOString().slice(0,10);
function transport(informationFirst=false){return vi.fn<typeof fetch>(async(url)=>{
 if(String(url).endsWith('/sessions'))return response(session('Published journey',informationFirst));
 const from=new URL(String(url)).searchParams.get('from')!;const start=new Date(Date.parse(from)+12*3600000).toISOString();
 return response({schemaVersion:1,serviceId:id,durationMinutes:30,slots:[{start,end:new Date(Date.parse(start)+1800000).toISOString(),remainingCapacity:1}]});
});}
async function open(){fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));await screen.findByRole('heading',{name:'Published journey'});}
async function schedule(){fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.change(screen.getByLabelText('Date (UTC)'),{target:{value:tomorrow()}});await screen.findByRole('radio');}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
it('requires explicit opening, uses only dedicated session/availability endpoints and never stores tokens or calls writers',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});const fetcher=transport();vi.stubGlobal('fetch',fetcher);const storage=vi.spyOn(Storage.prototype,'setItem');
 render(<HostedJourneyFlow installationId={id} config={config}/>);expect(fetcher).not.toHaveBeenCalled();await open();expect(screen.getByText('Home cleaning')).toBeVisible();await schedule();
 expect(fetcher.mock.calls[0]![0]).toBe(`https://api.example/api/paid-journey-installations/${id}/sessions`);
 expect(fetcher.mock.calls[0]![1]).toMatchObject({method:'POST',body:'{}',credentials:'omit',redirect:'error'});
 expect(fetcher.mock.calls.slice(1).every(([url,init])=>String(url).includes('/paid-journey-flow-sessions/availability?')&&init?.method==='GET'&&!init.body&&!('Origin' in (init.headers as Record<string,string>)))).toBe(true);
 fireEvent.click(screen.getByRole('radio'));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Staging customer'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'customer@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 expect(screen.getByText(/Booking submission and test payment are currently unavailable/)).toBeVisible();expect(screen.queryByRole('button',{name:/pay|confirm|submit/i})).toBeNull();expect(storage).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('x'.repeat(43));storage.mockRestore();
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('renders immutable published order/design and customer information before schedule when published that way',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});vi.stubGlobal('fetch',transport(true));render(<HostedJourneyFlow installationId={id} config={config}/>);await open();
 expect(screen.getByRole('main')).toHaveStyle({'--accent':'#0f766e',padding:'12px',minWidth:'0',boxSizing:'border-box'});
 expect(screen.getByRole('main')).toHaveClass('hosted-flow-card','paid-form-layout-compact');
 expect(screen.getByRole('navigation').textContent).toBe('ServiceInformationScheduleReview & PaymentConfirmation');
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));expect(screen.getByLabelText('Your name')).toBeVisible();expect(screen.queryByLabelText('Date (UTC)')).toBeNull();expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();
});
it.each(['demo','production','missing-key','missing-tenant','bad-api','http-page'])('fails closed on unavailable public configuration: %s',kind=>{
 vi.stubGlobal('location',{protocol:kind==='http-page'?'http:':'https:'});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const value={...config,...(kind==='demo'?{mode:'demo' as const}:kind==='production'?{environment:'production' as const}:kind==='missing-key'?{supabasePublishableKey:''}:kind==='missing-tenant'?{tenantId:''}:kind==='bad-api'?{flowApiOrigin:'http://api.example'}:{})};
 render(<HostedJourneyFlow installationId={id} config={value}/>);expect(screen.getByRole('alert')).toHaveTextContent('configuration could not be verified');expect(fetcher).not.toHaveBeenCalled();
});
it.each(['legacy-version','extra-private','wrong-token'])('rejects malformed session %s without issuing legacy fallback or auto retry',async kind=>{
 vi.stubGlobal('location',{protocol:'https:'});const data=session();const malformed=kind==='legacy-version'?{...data,render:{...data.render,renderSchemaVersion:7}}:kind==='extra-private'?{...data,tenantId:id}:{...data,sessionToken:'short'};
 const fetcher=vi.fn<typeof fetch>(async()=>response(malformed));vi.stubGlobal('fetch',fetcher);render(<HostedJourneyFlow installationId={id} config={config}/>);fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));
 await screen.findByRole('alert');expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.queryByText('Home cleaning')).toBeNull();expect(screen.getByRole('button',{name:'Open a new temporary session'})).toBeEnabled();
});
it('times out a stalled issuance, ignores its late receipt and retries only explicitly',async()=>{
 vi.useFakeTimers();vi.stubGlobal('location',{protocol:'https:'});let finish!:(value:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>finish=resolve));vi.stubGlobal('fetch',fetcher);
 render(<HostedJourneyFlow installationId={id} config={config}/>);fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(screen.getByRole('alert')).toHaveTextContent('may have been issued');expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
 await act(async()=>{finish(response(session('Late form')));});expect(screen.queryByText('Late form')).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('aborts pending issuance on installation replacement and unmount, never showing old authority',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});let finish!:(value:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>finish=resolve));vi.stubGlobal('fetch',fetcher);
 const view=render(<HostedJourneyFlow installationId={id} config={config}/>);fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));view.rerender(<HostedJourneyFlow installationId={other} config={config}/>);expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
 await act(async()=>finish(response(session('Old form'))));expect(screen.queryByText('Old form')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));view.unmount();expect(fetcher.mock.calls[1]![1]!.signal!.aborted).toBe(true);
});
it('clears selected slots on date change and discards out-of-order availability',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});const pending:Array<{url:string;finish:(r:Response)=>void}>=[];const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('/sessions')?response(session()):new Promise(resolve=>pending.push({url:String(url),finish:resolve})));vi.stubGlobal('fetch',fetcher);
 render(<HostedJourneyFlow installationId={id} config={config}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.change(screen.getByLabelText('Date (UTC)'),{target:{value:tomorrow()}});await waitFor(()=>expect(pending.length).toBe(2));
 const data=(entry:typeof pending[number])=>{const start=new Date(Date.parse(new URL(entry.url).searchParams.get('from')!)+12*3600000).toISOString();return {schemaVersion:1,serviceId:id,durationMinutes:30,slots:[{start,end:new Date(Date.parse(start)+1800000).toISOString(),remainingCapacity:1}]};};
 await act(async()=>pending[1]!.finish(response(data(pending[1]!))));fireEvent.click(screen.getByRole('radio'));expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled();
 const next=new Date(Date.now()+2*86400000).toISOString().slice(0,10);fireEvent.change(screen.getByLabelText('Date (UTC)'),{target:{value:next}});expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();expect(screen.queryByRole('radio')).toBeNull();
 await act(async()=>pending[0]!.finish(response(data(pending[0]!))));expect(screen.queryByRole('radio')).toBeNull();
});
it('rejects mismatched availability without creating selectable synthetic slots',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});vi.stubGlobal('fetch',vi.fn<typeof fetch>(async url=>String(url).endsWith('/sessions')?response(session()):response({schemaVersion:1,serviceId:other,durationMinutes:30,slots:[]})));
 render(<HostedJourneyFlow installationId={id} config={config}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Continue'}));await screen.findByRole('alert');expect(screen.queryByRole('radio')).toBeNull();expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();
});
it('expires the session and clears customer details and availability without automatic reissuance',async()=>{
 vi.useFakeTimers();vi.stubGlobal('location',{protocol:'https:'});const fetcher=transport(true);vi.stubGlobal('fetch',fetcher);render(<HostedJourneyFlow installationId={id} config={config}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));});fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Private name'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10*60000);});expect(screen.getByRole('alert')).toHaveTextContent('session expired');expect(screen.queryByLabelText('Your name')).toBeNull();expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('does not issue duplicate sessions on repeated opening clicks',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});const fetcher=vi.fn<typeof fetch>(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);render(<HostedJourneyFlow installationId={id} config={config}/>);
 const button=screen.getByRole('button',{name:'Open booking form'});fireEvent.click(button);fireEvent.click(button);expect(fetcher).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
});
it('rejects late receipt after public client configuration changes even when the installation stays the same',async()=>{
 vi.stubGlobal('location',{protocol:'https:'});let finish!:(value:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>finish=resolve));vi.stubGlobal('fetch',fetcher);const view=render(<HostedJourneyFlow installationId={id} config={config}/>);fireEvent.click(screen.getByRole('button',{name:'Open booking form'}));
 view.rerender(<HostedJourneyFlow installationId={id} config={{...config,flowApiOrigin:'https://other.example'}}/>);await act(async()=>finish(response(session('Wrong client form'))));expect(screen.queryByText('Wrong client form')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Open booking form'})).toBeEnabled();
});
it('replaces stalled availability with truthful failure and aborts it without a new session or synthetic slots',async()=>{
 vi.useFakeTimers();vi.stubGlobal('location',{protocol:'https:'});const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('/sessions')?response(session()):new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);render(<HostedJourneyFlow installationId={id} config={config}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Open booking form'})));fireEvent.click(screen.getByRole('button',{name:'Continue'}));await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(screen.getByRole('alert')).toHaveTextContent('Availability could not be verified');expect(fetcher.mock.calls[1]![1]!.signal!.aborted).toBe(true);expect(screen.queryByRole('radio')).toBeNull();expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(fetcher).toHaveBeenCalledTimes(2);
});
