import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {FieldDraftV3Editor} from './FieldDraftV3Editor';
import type {FieldDraftV3Client} from '../../../../packages/flow-ui/src/fieldDraftV3Client';
const layoutControl=vi.hoisted(()=>({suppress:false}));
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return {...actual,useLayoutEffect:(effect:()=>void|(()=>void),deps?:readonly unknown[])=>actual.useLayoutEffect(()=>layoutControl.suppress?undefined:effect(),deps)};});
afterEach(()=>{layoutControl.suppress=false;cleanup();});
const field={key:'question_a',kind:'text' as const,prompt:'Original',required:false,minLength:0,maxLength:100};
const receipt=()=>({fieldDraftVersion:3 as const,parentAuthoringVersion:2 as const,draftRevision:1,savedParentRevision:1,currentParentRevision:1,runtimePublishable:false as const,stale:false,definition:{schemaVersion:3 as const,fields:[field]}});
function setup(){const client:FieldDraftV3Client={read:vi.fn().mockResolvedValue({status:'present',receipt:receipt()}),save:vi.fn().mockResolvedValue({...receipt(),draftRevision:2}),invalidate:vi.fn()};return {client,props:{client,token:'synthetic',tenant:'tenant',flowId:'flow',parentRevision:1,parentDirty:false,enabled:true,onDirtyChange:vi.fn(),onBusyChange:vi.fn()}};}
async function load(){fireEvent.click(screen.getByText('Load questions'));await screen.findByLabelText('Question label');}
it('writes a mixed V3 definition with exact metadata and both revision tokens',async()=>{const {client,props}=setup();render(<FieldDraftV3Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Answer format'),{target:{value:'textarea'}});fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'  <b>Question</b>  '}});fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]?.[3]).toEqual({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:1,expectedFlowRevision:1,definition:{schemaVersion:3,fields:[{...field,kind:'textarea',prompt:'  <b>Question</b>  '}]}});});
it('rejects blank labels and invalid character limits without transport',async()=>{const {client,props}=setup();render(<FieldDraftV3Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'   '}});expect(screen.getByText('Save questions')).toBeDisabled();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Fine'}});fireEvent.change(screen.getByLabelText('Minimum characters'),{target:{value:'200'}});expect(screen.getByText('Save questions')).toBeDisabled();expect(client.save).not.toHaveBeenCalled();});
it('preserves edits after conflict and never retries automatically',async()=>{const {client,props}=setup();vi.mocked(client.save).mockRejectedValue({code:'CONFLICT'});render(<FieldDraftV3Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Keep me'}});fireEvent.click(screen.getByText('Save questions'));await screen.findByText(/Questions changed elsewhere/);expect(screen.getByLabelText('Question label')).toHaveValue('Keep me');expect(screen.getByText('Save questions')).toBeDisabled();expect(client.save).toHaveBeenCalledTimes(1);});
it('requires explicit latest read and stale acknowledgement after parent changes',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();view.rerender(<FieldDraftV3Editor {...props} parentRevision={2}/>);expect(screen.getByText('Save questions')).toBeDisabled();vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),currentParentRevision:2,stale:true}});fireEvent.click(screen.getByText('Check latest version'));const ack=await screen.findByLabelText('I reviewed these questions for the updated booking flow.');expect(screen.getByText('Save questions')).toBeDisabled();fireEvent.click(ack);expect(screen.getByText('Save questions')).not.toBeDisabled();});
it('fences late context reads and immediately hides previous fields',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();let resolve!:(v:any)=>void;vi.mocked(client.read).mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByText('Reload questions'));view.rerender(<FieldDraftV3Editor {...props} tenant="other"/>);expect(screen.queryByLabelText('Question label')).toBeNull();await act(async()=>resolve({status:'present',receipt:receipt()}));expect(screen.queryByLabelText('Question label')).toBeNull();expect(client.invalidate).toHaveBeenCalled();});
it('reports dirty and busy immediately to replacement observers',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Edited'}});let resolve!:(v:any)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByText('Save questions'));const dirty=vi.fn(),busy=vi.fn();view.rerender(<FieldDraftV3Editor {...props} onDirtyChange={dirty} onBusyChange={busy}/>);expect(dirty).toHaveBeenLastCalledWith(true);expect(busy).toHaveBeenLastCalledWith(true);await act(async()=>resolve({...receipt(),draftRevision:2}));});
it('disabled capability and unsaved parent prevent all reads',()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props} enabled={false}/>);expect(screen.queryByText('Load questions')).toBeNull();view.rerender(<FieldDraftV3Editor {...props} parentDirty/>);expect(screen.getByText('Load questions')).toBeDisabled();expect(client.read).not.toHaveBeenCalled();});

it('new context observers never receive old dirty or busy state',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Edited'}});let resolve!:(v:any)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByText('Save questions'));const dirty=vi.fn(),busy=vi.fn();view.rerender(<FieldDraftV3Editor {...props} tenant="new" onDirtyChange={dirty} onBusyChange={busy}/>);expect(dirty.mock.calls.every(([v])=>v===false)).toBe(true);expect(busy.mock.calls.every(([v])=>v===false)).toBe(true);expect(screen.queryByLabelText('Question label')).toBeNull();await act(async()=>resolve({...receipt(),draftRevision:2}));expect(screen.queryByLabelText('Question label')).toBeNull();});

it('render itself hides old status and busy before new context layout effects',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();let resolve!:(v:any)=>void;vi.mocked(client.read).mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByText('Reload questions'));expect(screen.getByRole('status').textContent).not.toBe('');layoutControl.suppress=true;view.rerender(<FieldDraftV3Editor {...props} tenant="different"/>);expect(screen.getByRole('status').textContent).toBe('');expect(screen.getByText('Load questions')).not.toBeDisabled();expect(screen.queryByLabelText('Question label')).toBeNull();layoutControl.suppress=false;await act(async()=>resolve({status:'present',receipt:receipt()}));});
it('new context reports its own loading and failure status after reset',async()=>{const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();view.rerender(<FieldDraftV3Editor {...props} tenant="new"/>);let reject!:(e:Error)=>void;vi.mocked(client.read).mockImplementationOnce(()=>new Promise((_,r)=>reject=r));fireEvent.click(screen.getByText('Load questions'));expect(screen.getByRole('status').textContent).not.toBe('');await act(async()=>reject(new Error('private error')));expect(screen.getByRole('status')).toHaveTextContent('Questions could not be loaded. Try again.');expect(screen.queryByText('private error')).toBeNull();});

it('keeps exact dropdown identities through label editing and reordering in a mixed dual-CAS save',async()=>{
 const {client,props}=setup();
 const dropdown={key:'vehicle',kind:'dropdown' as const,prompt:'Vehicle',required:true,choices:[{id:'opaque_b',label:'Same'},{id:'opaque_a',label:'Same'}]};
 vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),definition:{schemaVersion:3,fields:[field,{...field,key:'notes',kind:'textarea'},dropdown]}}});
 render(<FieldDraftV3Editor {...props}/>);fireEvent.click(screen.getByText('Load questions'));await screen.findByLabelText('Choice 1 label');
 fireEvent.change(screen.getByLabelText('Choice 1 label'),{target:{value:'  <b>Same</b>  '}});
 fireEvent.click(screen.getByLabelText('Move choice 1 down'));
 fireEvent.click(screen.getByText('Save questions'));
 await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));
 expect(vi.mocked(client.save).mock.calls[0]?.[3]).toEqual({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:1,expectedFlowRevision:1,definition:{schemaVersion:3,fields:[field,{...field,key:'notes',kind:'textarea'},{...dropdown,choices:[{id:'opaque_a',label:'Same'},{id:'opaque_b',label:'  <b>Same</b>  '}]}]}});
});
it.each(['revision','dirty'] as const)('fences a late save after a committed parent %s round trip and requires fresh reconciliation',async mode=>{
 const {client,props}=setup();const view=render(<FieldDraftV3Editor {...props}/>);await load();
 fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Unsaved'}});
 let resolve!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 fireEvent.click(screen.getByText('Save questions'));
 view.rerender(<FieldDraftV3Editor {...props} parentRevision={mode==='revision'?2:1} parentDirty={mode==='dirty'}/>);
 view.rerender(<FieldDraftV3Editor {...props}/>);
 await act(async()=>resolve({...receipt(),draftRevision:2}));
 expect(screen.getByLabelText('Question label')).toHaveValue('Unsaved');expect(screen.getByText('Save questions')).toBeDisabled();expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
 fireEvent.click(screen.getByText('Check latest version'));await waitFor(()=>expect(screen.getByText('Save questions')).not.toBeDisabled());
 expect(screen.getByLabelText('Question label')).toHaveValue('Unsaved');expect(client.save).toHaveBeenCalledTimes(1);
});

it('parent transition hides old status and acknowledgement during render before layout reset',async()=>{
 const {client,props}=setup();vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),stale:true}});
 const view=render(<FieldDraftV3Editor {...props}/>);await load();const label='I reviewed these questions for the updated booking flow.';
 fireEvent.click(screen.getByLabelText(label));expect(screen.getByLabelText(label)).toBeChecked();
 let resolve!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByText('Save questions'));
 expect(screen.getByRole('status')).toHaveTextContent('Working\u2026');layoutControl.suppress=true;
 view.rerender(<FieldDraftV3Editor {...props} parentRevision={2}/>);
 expect(screen.getByRole('status').textContent).toBe('');expect(screen.getByLabelText(label)).not.toBeChecked();expect(screen.getByText('Save questions')).toBeDisabled();
 layoutControl.suppress=false;await act(async()=>resolve({...receipt(),draftRevision:2}));
});

it('prevents implicit outer form submission from editor inputs while keeping buttons explicit',async()=>{
 const {props}=setup();const submitted=vi.fn((event:React.FormEvent)=>event.preventDefault());
 render(<form onSubmit={submitted}><FieldDraftV3Editor {...props}/></form>);await load();
 const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
 fireEvent(screen.getByLabelText('Question label'),enter);expect(enter.defaultPrevented).toBe(true);
 expect(fireEvent.keyDown(screen.getByLabelText('Answer format'),{key:'Enter'})).toBe(false);
 for(const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('type','button');
 expect(submitted).not.toHaveBeenCalled();
});

function dropdown(count=1,key='pick'){return {key,kind:'dropdown' as const,prompt:'Pick',required:false,choices:Array.from({length:count},(_,i)=>({id:`id_${i}`,label:`Option ${i}`}))};}
it.each([32,256,64])('enforces the %i structural boundary before mutation',async limit=>{
 const {client,props}=setup();const fields=limit===32?[dropdown(32)]:limit===256?Array.from({length:8},(_,i)=>dropdown(32,`pick_${i}`)):Array.from({length:64},(_,i)=>({...field,key:`text_${i}`}));
 vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),definition:{schemaVersion:3,fields}}});render(<FieldDraftV3Editor {...props}/>);await act(async()=>{fireEvent.click(screen.getByText('Load questions'));});expect(screen.getAllByText('Question label')).toHaveLength(fields.length);
 if(limit!==64) for(const button of screen.getAllByText('Add choice')) expect(button).toBeDisabled();
 if(limit!==32) expect(screen.getByText('Add dropdown question')).toBeDisabled();
 if(limit===64) expect(screen.getByText('Add text question')).toBeDisabled();
 expect(client.save).not.toHaveBeenCalled();
});
it('keeps the last choice and excludes rehearsal answers from saved definitions',async()=>{
 const {client,props}=setup();const choice=dropdown();vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),definition:{schemaVersion:3,fields:[choice]}}});
 render(<FieldDraftV3Editor {...props}/>);fireEvent.click(screen.getByText('Load questions'));await screen.findByLabelText('Choice 1 label');expect(screen.getByLabelText('Remove choice 1')).toBeDisabled();
 fireEvent.click(screen.getByText('Try questions'));fireEvent.change(screen.getByLabelText('Pick'),{target:{value:'id_0'}});fireEvent.click(screen.getByText('Save questions'));
 await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]?.[3]).toEqual({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:1,expectedFlowRevision:1,definition:{schemaVersion:3,fields:[choice]}});
});
it('blocks choice mutation in the same event stack after save starts',async()=>{
 const {client,props}=setup();const choice=dropdown(2);vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),definition:{schemaVersion:3,fields:[choice]}}});
 let resolve!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 render(<FieldDraftV3Editor {...props}/>);fireEvent.click(screen.getByText('Load questions'));await screen.findByLabelText('Choice 1 label');
 act(()=>{screen.getByText('Save questions').click();fireEvent.change(screen.getByLabelText('Choice 1 label'),{target:{value:'Race'}});screen.getByLabelText('Remove choice 1').click();});
 expect(screen.getByLabelText('Choice 1 label')).toHaveValue('Option 0');expect(vi.mocked(client.save).mock.calls[0]?.[3]).toEqual({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:1,expectedFlowRevision:1,definition:{schemaVersion:3,fields:[choice]}});
 await act(async()=>resolve(receipt()));
});
