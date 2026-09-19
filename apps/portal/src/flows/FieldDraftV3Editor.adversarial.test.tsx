import {afterEach,expect,it,vi} from 'vitest';
import {useInsertionEffect} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {FieldDraftV3Client} from '../../../../packages/flow-ui/src/fieldDraftV3Client';
import {FlowError} from '../../../../packages/flow-ui/src/client';
import {FieldDraftV3Editor} from './FieldDraftV3Editor';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const tenant='11111111-1111-4111-8111-111111111111',flowId='22222222-2222-4222-8222-222222222222';
const field={key:'internal_q',kind:'dropdown' as const,required:false,prompt:'Private question',choices:[{id:'first',label:'Same label'},{id:'second',label:'Same label'}]};
const receipt=()=>({fieldDraftVersion:3 as const,parentAuthoringVersion:2 as const,draftRevision:2,savedParentRevision:3,currentParentRevision:3,definition:{schemaVersion:3 as const,fields:[field]},runtimePublishable:false as const,stale:false});
function setup(){const client:FieldDraftV3Client={invalidate:vi.fn(),read:vi.fn<FieldDraftV3Client['read']>().mockResolvedValue({status:'present',receipt:receipt()}),save:vi.fn<FieldDraftV3Client['save']>().mockResolvedValue({...receipt(),draftRevision:3})};return {client,props:{client,token:'synthetic-owner-token',tenant,flowId,parentRevision:3,parentDirty:false,enabled:true,onDirtyChange:vi.fn(),onBusyChange:vi.fn()}};}
async function load(){fireEvent.click(screen.getByText('Load questions'));await screen.findByDisplayValue('Private question');}
const edit=()=>fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Keep exact private edits'}});

it('defaults off and prohibits requests with an unsaved parent',()=>{
 const {client,props}=setup(),{enabled:_,...disabled}=props,view=render(<FieldDraftV3Editor {...disabled}/>);
 expect(screen.queryByText('Load questions')).toBeNull();view.rerender(<FieldDraftV3Editor {...props} parentDirty/>);fireEvent.click(screen.getByText('Load questions'));expect(screen.getByText('Load questions')).toBeDisabled();expect(client.read).not.toHaveBeenCalled();expect(client.save).not.toHaveBeenCalled();
});

it.each(['tenant','token','flow','client','capability'])('hides old values at the %s replacement commit and ignores its pending save',async kind=>{
 const {client,props}=setup(),snapshots:string[][]=[];
 function Probe({input}:{input:typeof props}){useInsertionEffect(()=>{snapshots.push([...document.querySelectorAll('input')].map(node=>node.value));});return <FieldDraftV3Editor {...input}/>;}
 const view=render(<Probe input={props}/>);await load();edit();let finish!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByText('Save questions'));
 const changed={...props,...(kind==='tenant'?{tenant:flowId}:kind==='token'?{token:'replacement-owner-token'}:kind==='flow'?{flowId:tenant}:kind==='client'?{client:setup().client}:{enabled:false})};snapshots.length=0;view.rerender(<Probe input={changed}/>);
 expect(snapshots.length).toBeGreaterThan(0);for(const values of snapshots){expect(values).not.toContain('Keep exact private edits');expect(values).not.toContain('Same label');}
 await act(async()=>finish(receipt()));expect(screen.queryByDisplayValue('Keep exact private edits')).toBeNull();expect(screen.queryByDisplayValue('Private question')).toBeNull();expect(client.invalidate).toHaveBeenCalled();
});

it.each([['read','revision'],['save','revision'],['read','dirty'],['save','dirty']] as const)('invalidates pending %s after a parent %s round trip without discarding edits',async(operation,change)=>{
 const {client,props}=setup(),view=render(<FieldDraftV3Editor {...props}/>);await load();edit();let finish!:()=>void;
 if(operation==='read'){vi.mocked(client.read).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({status:'present',receipt:receipt()});}));fireEvent.click(screen.getByText('Check latest version'));}
 else{vi.mocked(client.save).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({...receipt(),draftRevision:3});}));fireEvent.click(screen.getByText('Save questions'));}
 view.rerender(<FieldDraftV3Editor {...props} {...(change==='revision'?{parentRevision:4}:{parentDirty:true})}/>);view.rerender(<FieldDraftV3Editor {...props}/>);await act(async()=>finish());
 expect(screen.getByLabelText('Question label')).toHaveValue('Keep exact private edits');expect(screen.getByText('Save questions')).toBeDisabled();expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);expect(client.save).toHaveBeenCalledTimes(operation==='save'?1:0);
 fireEvent.click(screen.getByText('Save questions'));expect(client.save).toHaveBeenCalledTimes(operation==='save'?1:0);
 vi.mocked(client.read).mockResolvedValue({status:'present',receipt:receipt()});fireEvent.click(screen.getByText('Check latest version'));await waitFor(()=>expect(screen.getByText('Save questions')).not.toBeDisabled());expect(screen.getByLabelText('Question label')).toHaveValue('Keep exact private edits');
});

it('an old completion cannot clear a new context busy operation',async()=>{
 const {client,props}=setup();let old!:(value:Awaited<ReturnType<FieldDraftV3Client['read']>>)=>void,newer!:typeof old;
 vi.mocked(client.read).mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{newer=resolve;}));const view=render(<FieldDraftV3Editor {...props}/>);fireEvent.click(screen.getByText('Load questions'));view.rerender(<FieldDraftV3Editor {...props} tenant={flowId}/>);fireEvent.click(screen.getByText('Load questions'));
 await act(async()=>old({status:'present',receipt:receipt()}));expect(screen.queryByDisplayValue('Private question')).toBeNull();expect(props.onBusyChange).toHaveBeenLastCalledWith(true);expect(screen.getByText('Load questions')).toBeDisabled();await act(async()=>newer({status:'present',receipt:receipt()}));expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

it('retains exact edits on conflict without retrying or exposing raw errors',async()=>{
 const {client,props}=setup();vi.mocked(client.save).mockRejectedValue(new FlowError('CONFLICT'));render(<FieldDraftV3Editor {...props}/>);await load();edit();fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(props.onBusyChange).toHaveBeenLastCalledWith(false));expect(screen.getByLabelText('Question label')).toHaveValue('Keep exact private edits');expect(screen.getByText('Save questions')).toBeDisabled();fireEvent.click(screen.getByText('Save questions'));expect(client.save).toHaveBeenCalledTimes(1);expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
});

it('preserves distinct choice IDs and order despite duplicate labels in the exact dual-CAS payload',async()=>{
 const {client,props}=setup();render(<FieldDraftV3Editor {...props}/>);await load();expect(screen.queryByLabelText('Answer format')).toBeNull();edit();fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]).toEqual([props.token,tenant,flowId,{fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:2,expectedFlowRevision:3,definition:{schemaVersion:3,fields:[{...field,prompt:'Keep exact private edits'}]}}]);
});

it('a throwing UUID source leaves existing fields and dirty state untouched',async()=>{
 const {client,props}=setup();render(<FieldDraftV3Editor {...props}/>);await load();vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw new Error('private generator failure');});fireEvent.click(screen.getByText('Add dropdown question'));expect(screen.getAllByLabelText('Question label')).toHaveLength(1);expect(screen.getByLabelText('Question label')).toHaveValue('Private question');expect(props.onDirtyChange).not.toHaveBeenCalledWith(true);expect(document.body.textContent).not.toContain('private generator failure');expect(client.save).not.toHaveBeenCalled();
});

it('bounded UUID collisions cannot duplicate a question or corrupt existing fields',async()=>{
 const {props}=setup();render(<FieldDraftV3Editor {...props}/>);await load();const random=vi.spyOn(crypto,'randomUUID').mockReturnValue('33333333-3333-4333-8333-333333333333');fireEvent.click(screen.getByText('Add dropdown question'));expect(screen.getAllByLabelText('Question label')).toHaveLength(2);
 const before=[...document.querySelectorAll('input')].map(node=>node.value);random.mockClear();props.onDirtyChange.mockClear();fireEvent.click(screen.getByText('Add dropdown question'));expect(random).toHaveBeenCalledTimes(4);expect(screen.getAllByLabelText('Question label')).toHaveLength(2);expect([...document.querySelectorAll('input')].map(node=>node.value)).toEqual(before);expect(props.onDirtyChange).not.toHaveBeenCalled();
});

it('parent transitions never commit a previous success status',async()=>{
 const {props}=setup(),snapshots:string[]=[];
 function Probe({revision}:{revision:number}){useInsertionEffect(()=>{snapshots.push(document.querySelector('[data-probe] [role="status"]')?.textContent??'');},[revision]);return <div data-probe><FieldDraftV3Editor {...props} parentRevision={revision}/></div>;}
 const view=render(<Probe revision={3}/>);await load();fireEvent.click(screen.getByText('Save questions'));await screen.findByText('Questions saved as a draft.');snapshots.length=0;view.rerender(<Probe revision={4}/>);expect(snapshots).toHaveLength(1);expect(snapshots[0]).not.toContain('Questions saved as a draft.');
});

it('parent transitions never commit stale acknowledgement as checked',async()=>{
 const {client,props}=setup();vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),savedParentRevision:2,stale:true}});const snapshots:boolean[]=[];
 function Probe({dirty}:{dirty:boolean}){useInsertionEffect(()=>{const acknowledgement=[...document.querySelectorAll('input[type="checkbox"]')].find(node=>node.parentElement?.textContent?.includes('I reviewed these questions'));snapshots.push((acknowledgement as HTMLInputElement|undefined)?.checked??false);},[dirty]);return <FieldDraftV3Editor {...props} parentDirty={dirty}/>;}
 const view=render(<Probe dirty={false}/>);await load();fireEvent.click(screen.getByLabelText('I reviewed these questions for the updated booking flow.'));expect(screen.getByLabelText('I reviewed these questions for the updated booking flow.')).toBeChecked();snapshots.length=0;view.rerender(<Probe dirty/>);expect(snapshots).toEqual([false]);
});
