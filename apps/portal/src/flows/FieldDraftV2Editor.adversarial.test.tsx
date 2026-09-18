import { afterEach, expect, it, vi } from 'vitest';
import { useInsertionEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FieldDraftV2Client } from '../../../../packages/flow-ui/src/fieldDraftV2Client';
import { FlowError } from '../../../../packages/flow-ui/src/client';
import { FieldDraftV2Editor } from './FieldDraftV2Editor';
afterEach(cleanup);
const tenant='11111111-1111-4111-8111-111111111111',flowId='22222222-2222-4222-8222-222222222222';
const field={key:'internal_q',kind:'textarea' as const,required:false,minLength:0,maxLength:100,prompt:'Private question'};
const receipt=()=>({fieldDraftVersion:2 as const,parentAuthoringVersion:2 as const,draftRevision:2,savedParentRevision:3,currentParentRevision:3,definition:{schemaVersion:2 as const,fields:[field]},runtimePublishable:false as const,stale:false});
function setup(){const client:FieldDraftV2Client={invalidate:vi.fn(),read:vi.fn<FieldDraftV2Client['read']>().mockResolvedValue({status:'present',receipt:receipt()}),save:vi.fn<FieldDraftV2Client['save']>().mockResolvedValue(receipt())};return {client,props:{client,token:'synthetic-owner-token',tenant,flowId,parentRevision:3,parentDirty:false,enabled:true,onDirtyChange:vi.fn(),onBusyChange:vi.fn()}};}
async function load(){fireEvent.click(screen.getByText('Load questions'));await screen.findByDisplayValue('Private question');}
it.each(['tenant','token','flow','client','capability'])('gates old fields immediately on %s replacement and ignores pending save',async kind=>{
 const {client,props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);await load();let finish!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Unsaved secret'}});fireEvent.click(screen.getByText('Save questions'));
 const changed={...props,...(kind==='tenant'?{tenant:flowId}:kind==='token'?{token:'new-owner-token'}:kind==='flow'?{flowId:tenant}:kind==='client'?{client:setup().client}:{enabled:false})};view.rerender(<FieldDraftV2Editor {...changed}/>);expect(screen.queryByDisplayValue('Unsaved secret')).toBeNull();await act(async()=>finish(receipt()));expect(screen.queryByDisplayValue('Private question')).toBeNull();expect(screen.queryByDisplayValue('Unsaved secret')).toBeNull();expect(client.invalidate).toHaveBeenCalled();
});
it('old pending load cannot clear a new context busy operation',async()=>{
 const {client,props}=setup();let old!:(value:Awaited<ReturnType<FieldDraftV2Client['read']>>)=>void,newer!:typeof old;vi.mocked(client.read).mockImplementationOnce(()=>new Promise(r=>{old=r;})).mockImplementationOnce(()=>new Promise(r=>{newer=r;}));const view=render(<FieldDraftV2Editor {...props}/>);fireEvent.click(screen.getByText('Load questions'));view.rerender(<FieldDraftV2Editor {...props} tenant={flowId}/>);fireEvent.click(screen.getByText('Load questions'));await act(async()=>old({status:'present',receipt:receipt()}));expect(screen.queryByDisplayValue('Private question')).toBeNull();expect(props.onBusyChange).toHaveBeenLastCalledWith(true);expect(screen.getByText('Load questions')).toBeDisabled();await act(async()=>newer({status:'present',receipt:receipt()}));expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});
it('disabled capability and dirty parent prohibit requests',()=>{
 const {client,props}=setup(),view=render(<FieldDraftV2Editor {...props} enabled={false}/>);expect(screen.queryByText('Load questions')).toBeNull();view.rerender(<FieldDraftV2Editor {...props} parentDirty/>);expect(screen.getByText('Load questions')).toBeDisabled();fireEvent.click(screen.getByText('Load questions'));expect(client.read).not.toHaveBeenCalled();expect(client.save).not.toHaveBeenCalled();
});
it('duplicate save clicks admit only one request and report busy synchronously',async()=>{
 const {client,props}=setup();let finish!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<FieldDraftV2Editor {...props}/>);await load();const button=screen.getByText('Save questions');fireEvent.click(button);expect(props.onBusyChange).toHaveBeenLastCalledWith(true);fireEvent.click(button);expect(client.save).toHaveBeenCalledTimes(1);await act(async()=>finish(receipt()));expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});
it('CAS failure preserves local edits without retry and requires explicit reconciliation',async()=>{
 const {client,props}=setup();vi.mocked(client.save).mockRejectedValue(new FlowError('CONFLICT'));render(<FieldDraftV2Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Keep exact edits'}});fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(props.onBusyChange).toHaveBeenLastCalledWith(false));expect(screen.getByLabelText('Question label')).toHaveValue('Keep exact edits');expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);expect(client.save).toHaveBeenCalledTimes(1);expect(screen.getByText('Save questions')).toBeDisabled();
});
it('parent revision change retains edits and does not silently rebind save',async()=>{
 const {client,props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Retained edit'}});view.rerender(<FieldDraftV2Editor {...props} parentRevision={4}/>);expect(screen.getByLabelText('Question label')).toHaveValue('Retained edit');expect(screen.getByText('Save questions')).toBeDisabled();expect(client.save).not.toHaveBeenCalled();
 vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),currentParentRevision:4,stale:true}});fireEvent.click(screen.getByText('Check latest version'));await waitFor(()=>expect(screen.getByLabelText('I reviewed these questions for the updated booking flow.')).toBeInTheDocument());expect(screen.getByText('Save questions')).toBeDisabled();fireEvent.click(screen.getByLabelText('I reviewed these questions for the updated booking flow.'));fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]?.[3]).toMatchObject({expectedRevision:2,expectedFlowRevision:4,definition:{fields:[{prompt:'Retained edit'}]}});
});
it('invalid prompts and limits remain unsaved while HTML-like labels are escaped',async()=>{
 const {client,props}=setup();render(<FieldDraftV2Editor {...props}/>);await load();for(const prompt of ['','\n','x'.repeat(201)]) {fireEvent.change(screen.getByLabelText('Question label'),{target:{value:prompt}});expect(screen.getByText('Save questions')).toBeDisabled();}fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'<img src=x onerror=alert(1)>'}});expect(document.querySelector('img')).toBeNull();fireEvent.change(screen.getByLabelText('Maximum characters'),{target:{value:'-1'}});expect(screen.getByText('Save questions')).toBeDisabled();expect(client.save).not.toHaveBeenCalled();
});
it('format edits preserve stable keys and replacement observers receive retained state',async()=>{
 const {client,props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Answer format'),{target:{value:'text'}});const dirty=vi.fn(),busy=vi.fn();view.rerender(<FieldDraftV2Editor {...props} onDirtyChange={dirty} onBusyChange={busy}/>);expect(dirty).toHaveBeenLastCalledWith(true);expect(busy).toHaveBeenLastCalledWith(false);fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]?.[3]).toMatchObject({definition:{fields:[{key:field.key,kind:'text',prompt:field.prompt}]}});
});
it.each(['read','save'])('parent revision changed during pending %s requires a fresh check before save',async operation=>{
 const {client,props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);
 let finish!:()=>void;
 if(operation==='read'){vi.mocked(client.read).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({status:'present',receipt:receipt()});}));fireEvent.click(screen.getByText('Load questions'));}
 else{await load();vi.mocked(client.save).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(receipt());}));fireEvent.click(screen.getByText('Save questions'));}
 view.rerender(<FieldDraftV2Editor {...props} parentRevision={4}/>);await act(async()=>finish());expect(screen.getByText('Save questions')).toBeDisabled();expect(client.save).toHaveBeenCalledTimes(operation==='save'?1:0);
 vi.mocked(client.read).mockResolvedValue({status:'present',receipt:{...receipt(),currentParentRevision:4,stale:true}});fireEvent.click(screen.getByText('Check latest version'));await screen.findByLabelText('I reviewed these questions for the updated booking flow.');expect(screen.getByText('Save questions')).toBeDisabled();fireEvent.click(screen.getByLabelText('I reviewed these questions for the updated booking flow.'));expect(screen.getByText('Save questions')).not.toBeDisabled();
});
it('same-stack add during pending save cannot mutate the admitted definition',async()=>{
 const {client,props}=setup();let finish!:(value:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<FieldDraftV2Editor {...props}/>);await load();const saveButton=screen.getByText('Save questions'),addButton=screen.getByText('Add text question');
 act(()=>{saveButton.click();addButton.click();});expect(screen.getAllByLabelText('Question label')).toHaveLength(1);expect(props.onDirtyChange).not.toHaveBeenCalledWith(true);await act(async()=>finish(receipt()));
});
it('simultaneous identity and observer replacement never reports the prior dirty context',async()=>{
 const {props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Prior tenant secret'}});expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
 const dirty=vi.fn(),busy=vi.fn();view.rerender(<FieldDraftV2Editor {...props} tenant={flowId} token="replacement-owner-token" onDirtyChange={dirty} onBusyChange={busy}/>);
 expect(screen.queryByDisplayValue('Prior tenant secret')).toBeNull();expect(dirty).toHaveBeenCalledWith(false);expect(dirty).not.toHaveBeenCalledWith(true);expect(busy).not.toHaveBeenCalledWith(true);
});
it('does not commit previous-context status text before layout reset',async()=>{
 const {props}=setup(),snapshots:string[]=[];
 function Observed({token}:{token:string}){useInsertionEffect(()=>{snapshots.push(document.querySelector('[data-status-probe] [role="status"]')?.textContent??'');},[token]);return <div data-status-probe><FieldDraftV2Editor {...props} token={token}/></div>;}
 const view=render(<Observed token={props.token}/>);await load();fireEvent.click(screen.getByText('Save questions'));await screen.findByText('Questions saved as a draft.');snapshots.length=0;
 view.rerender(<Observed token="next-owner-token"/>);expect(snapshots).toEqual(['']);expect(screen.queryByText('Questions saved as a draft.')).toBeNull();
});
