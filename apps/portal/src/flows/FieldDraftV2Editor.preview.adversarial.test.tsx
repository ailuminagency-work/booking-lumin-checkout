import {useInsertionEffect} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {FieldDraftV2Client} from '../../../../packages/flow-ui/src/fieldDraftV2Client';
import {FlowError} from '../../../../packages/flow-ui/src/client';
import {FieldDraftV2Editor} from './FieldDraftV2Editor';
afterEach(cleanup);
const fields=[{key:'q1',kind:'textarea' as const,prompt:'Instructions',required:false,minLength:0,maxLength:100},{key:'q2',kind:'text' as const,prompt:'Name',required:false,minLength:0,maxLength:100}];
const receipt=()=>({fieldDraftVersion:2 as const,parentAuthoringVersion:2 as const,draftRevision:1,savedParentRevision:3,currentParentRevision:3,definition:{schemaVersion:2 as const,fields},runtimePublishable:false as const,stale:false});
function setup(){const client:FieldDraftV2Client={invalidate:vi.fn(),read:vi.fn<FieldDraftV2Client['read']>().mockResolvedValue({status:'present',receipt:receipt()}),save:vi.fn<FieldDraftV2Client['save']>().mockResolvedValue(receipt())};return {client,props:{client,token:'synthetic-owner-token',tenant:'11111111-1111-4111-8111-111111111111',flowId:'22222222-2222-4222-8222-222222222222',parentRevision:3,parentDirty:false,enabled:true,onDirtyChange:vi.fn(),onBusyChange:vi.fn()}};}
const region=()=>screen.getByRole('region',{name:'Question preview'});
async function load(){fireEvent.click(screen.getByText('Load questions'));await screen.findByDisplayValue('Instructions');}
function open(){fireEvent.click(screen.getByText('Try questions'));fireEvent.change(within(region()).getByLabelText('Instructions'),{target:{value:'Private answer\nsecond line'}});}
it('preview answers/checks never invoke transport or alter saved definition and callbacks',async()=>{
 const {client,props}=setup();render(<FieldDraftV2Editor {...props}/>);await load();const dirty=props.onDirtyChange.mock.calls.length,busy=props.onBusyChange.mock.calls.length;open();fireEvent.click(within(region()).getByText('Check answers'));expect(client.read).toHaveBeenCalledTimes(1);expect(client.save).not.toHaveBeenCalled();expect(props.onDirtyChange).toHaveBeenCalledTimes(dirty);expect(props.onBusyChange).toHaveBeenCalledTimes(busy);fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(client.save).toHaveBeenCalledTimes(1));expect(vi.mocked(client.save).mock.calls[0]?.[3]).toEqual({fieldDraftVersion:2,parentAuthoringVersion:2,expectedRevision:1,expectedFlowRevision:3,definition:{schemaVersion:2,fields}});expect(JSON.stringify(vi.mocked(client.save).mock.calls)).not.toContain('Private answer');
});
it.each(['label','kind','limits','reorder','remove'])('%s edit closes previous preview and clears its answers',async change=>{
 const {props}=setup();render(<FieldDraftV2Editor {...props}/>);await load();open();
 if(change==='label')fireEvent.change(screen.getAllByLabelText('Question label')[0]!,{target:{value:'Changed'}});
 else if(change==='kind')fireEvent.change(screen.getAllByLabelText('Answer format')[0]!,{target:{value:'text'}});
 else if(change==='limits')fireEvent.change(screen.getAllByLabelText('Maximum characters')[0]!,{target:{value:'50'}});
 else fireEvent.click(screen.getByLabelText(change==='reorder'?'Move question 1 down':'Remove question 1'));
 expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();fireEvent.click(screen.getByText('Try questions'));for(const control of within(region()).getAllByRole('textbox'))expect((control as HTMLInputElement).value).toBe('');
});
it.each(['token','tenant','client','enabled','parentDirty','parentRevision'])('%s change cannot commit old preview answers',async change=>{
 const {props}=setup(),snapshots:string[]=[];function Probe({next}:{next:typeof props}){useInsertionEffect(()=>{snapshots.push(document.querySelector('[aria-label="Question preview"]')?.textContent??'absent');});return <FieldDraftV2Editor {...next}/>;}
 const view=render(<Probe next={props}/>);await load();open();fireEvent.click(within(region()).getByText('Check answers'));snapshots.length=0;const changed={...props,...(change==='token'?{token:'new-owner-token'}:change==='tenant'?{tenant:props.flowId}:change==='client'?{client:setup().client}:change==='enabled'?{enabled:false}:change==='parentDirty'?{parentDirty:true}:{parentRevision:4})};view.rerender(<Probe next={changed}/>);expect(snapshots).toEqual(['absent']);expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();
});
it('pending save synchronously prevents same-stack reopening and late completion cannot restore preview',async()=>{
 const {client,props}=setup();let finish!:(v:ReturnType<typeof receipt>)=>void;vi.mocked(client.save).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<FieldDraftV2Editor {...props}/>);await load();open();fireEvent.click(screen.getByText('Close preview'));const tryButton=screen.getByText('Try questions'),saveButton=screen.getByText('Save questions');act(()=>{saveButton.click();tryButton.click();});expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();await act(async()=>finish(receipt()));expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();
});
it('conflict and stale parent prevent preview reopening without reconciliation',async()=>{
 const {client,props}=setup();vi.mocked(client.save).mockRejectedValue(new FlowError('CONFLICT'));render(<FieldDraftV2Editor {...props}/>);await load();open();fireEvent.click(screen.getByText('Save questions'));await waitFor(()=>expect(screen.getByText('Save questions')).toBeDisabled());expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();expect(screen.getByText('Try questions')).toBeDisabled();
});
it.each(['parentDirty','parentRevision'])('%s toggled away and back cannot resurrect preview',async change=>{
 const {props}=setup(),view=render(<FieldDraftV2Editor {...props}/>);await load();open();view.rerender(<FieldDraftV2Editor {...props} {...(change==='parentDirty'?{parentDirty:true}:{parentRevision:4})}/>);view.rerender(<FieldDraftV2Editor {...props}/>);expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();fireEvent.click(screen.getByText('Try questions'));expect((within(region()).getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('');
});
it('failed reload retires preview and invalid local definition cannot reopen it',async()=>{
 const {client,props}=setup();render(<FieldDraftV2Editor {...props}/>);await load();open();vi.mocked(client.read).mockRejectedValueOnce(new Error('private'));fireEvent.click(screen.getByText('Reload questions'));await screen.findByText('Questions could not be loaded. Try again.');expect(screen.queryByRole('region',{name:'Question preview'})).toBeNull();fireEvent.change(screen.getAllByLabelText('Maximum characters')[0]!,{target:{value:''}});expect(screen.getByText('Try questions')).toBeDisabled();expect(client.save).not.toHaveBeenCalled();
});
