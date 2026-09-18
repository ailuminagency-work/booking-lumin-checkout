import { useInsertionEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { FieldDraftV2Client } from '../../../../packages/flow-ui/src/fieldDraftV2Client';
import { LocalFieldDraftV2Host, LocalFieldDraftV2Route } from './LocalFieldDraftV2Host';
const routers:ReturnType<typeof createMemoryRouter>[]=[];
afterEach(()=>{cleanup();routers.splice(0).forEach(router=>router.dispose());});
const receipt={fieldDraftVersion:2 as const,parentAuthoringVersion:2 as const,draftRevision:1,savedParentRevision:4,currentParentRevision:4,definition:{schemaVersion:2 as const,fields:[{key:'internal',kind:'textarea' as const,prompt:'Saved private question',required:false,minLength:0,maxLength:100}]},runtimePublishable:false as const,stale:false};
function clientMock():FieldDraftV2Client{return {invalidate:vi.fn(),read:vi.fn<FieldDraftV2Client['read']>().mockResolvedValue({status:'present',receipt}),save:vi.fn<FieldDraftV2Client['save']>().mockResolvedValue(receipt)};}
function setup(observe?:()=>void){const client=clientMock(),confirm=vi.fn(()=>false);let props={client,token:'synthetic-owner-token',tenant:'11111111-1111-4111-8111-111111111111',flowId:'22222222-2222-4222-8222-222222222222',parentRevision:4,parentDirty:false,enabled:true,confirmDiscard:confirm};let refresh!:()=>void;
 function Host(){const [,tick]=useState(0);refresh=()=>tick(v=>v+1);useInsertionEffect(()=>{observe?.();});return <LocalFieldDraftV2Host {...props}/>;}
 const router=createMemoryRouter([{path:'/',element:<Host/>,children:[{path:'edit',element:<LocalFieldDraftV2Route/>},{path:'other',element:<p>Other page</p>}]}],{initialEntries:['/edit']});routers.push(router);render(<RouterProvider router={router}/>);
 return {client,confirm,router,update(change:Partial<typeof props>){props={...props,...change};act(()=>refresh());},async go(to:string){await act(async()=>{await router.navigate(to);});}};
}
async function load(){fireEvent.click(await screen.findByText('Load questions'));await screen.findByDisplayValue('Saved private question');}
it.each(['read','save'])('reports busy before %s can synchronously attempt navigation',async operation=>{
 const s=setup();if(operation==='save')await load();let finish!:()=>void;
 if(operation==='read')vi.mocked(s.client.read).mockImplementationOnce(()=>{void s.router.navigate('/other');return new Promise(resolve=>{finish=()=>resolve({status:'present',receipt});});});
 else vi.mocked(s.client.save).mockImplementationOnce(()=>{void s.router.navigate('/other');return new Promise(resolve=>{finish=()=>resolve(receipt);});});
 fireEvent.click(await screen.findByText(operation==='read'?'Load questions':'Save questions'));expect(s.router.state.location.pathname).toBe('/edit');expect(s.confirm).not.toHaveBeenCalled();await act(async()=>finish());
});
it('dirty navigation cancel retains edits; accepted departure never resurrects local data',async()=>{
 const s=setup();await load();act(()=>{fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Discard me'}});void s.router.navigate('/other');});expect(s.router.state.location.pathname).toBe('/edit');expect(screen.getByDisplayValue('Discard me')).toBeVisible();expect(s.confirm).toHaveBeenCalledTimes(1);s.confirm.mockReturnValue(true);await s.go('/other');expect(screen.getByText('Other page')).toBeVisible();await s.go('/edit');expect(screen.queryByDisplayValue('Discard me')).toBeNull();await load();
});
it.each(['tenant','token','flow','client','enabled'])('retires %s context and cannot let old save clear new busy state',async kind=>{
 const s=setup();await load();let old!:(value:typeof receipt)=>void;vi.mocked(s.client.save).mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Old private edits'}});fireEvent.click(screen.getByText('Save questions'));
 const newClient=kind==='client'?clientMock():s.client;
 s.update(kind==='tenant'?{tenant:'33333333-3333-4333-8333-333333333333'}:kind==='token'?{token:'replacement-owner-token'}:kind==='flow'?{flowId:'44444444-4444-4444-8444-444444444444'}:kind==='client'?{client:newClient}:{enabled:false});expect(screen.queryByDisplayValue('Old private edits')).toBeNull();
 if(kind==='enabled'){await act(async()=>old(receipt));expect(screen.queryByDisplayValue('Saved private question')).toBeNull();expect(screen.queryByText('Load questions')).toBeNull();return;}
 let fresh!:(value:{status:'present';receipt:typeof receipt})=>void;vi.mocked(newClient.read).mockImplementationOnce(()=>new Promise(resolve=>{fresh=resolve;}));fireEvent.click(await screen.findByText('Load questions'));await act(async()=>old(receipt));expect(screen.queryByDisplayValue('Old private edits')).toBeNull();await s.go('/other');expect(s.router.state.location.pathname).toBe('/edit');expect(s.confirm).not.toHaveBeenCalled();await act(async()=>fresh({status:'present',receipt}));await waitFor(()=>expect(screen.getByDisplayValue('Saved private question')).toBeVisible());expect(s.client.invalidate).toHaveBeenCalled();
});
it('parent revision retains dirty text and blocks save without an implicit client call',async()=>{
 const s=setup();await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Keep on parent update'}});s.update({parentRevision:5});expect(screen.getByDisplayValue('Keep on parent update')).toBeVisible();expect(screen.getByText('Save questions')).toBeDisabled();await s.go('/other');expect(s.router.state.location.pathname).toBe('/edit');expect(s.client.save).not.toHaveBeenCalled();
});
it('parent dirty state retains edits but prohibits save and reload transport',async()=>{
 const s=setup();await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Keep parent dirty edit'}});s.update({parentDirty:true});expect(screen.getByDisplayValue('Keep parent dirty edit')).toBeVisible();expect(screen.getByText('Save questions')).toBeDisabled();expect(screen.getByText('Check latest version')).toBeDisabled();fireEvent.click(screen.getByText('Save questions'));expect(s.client.save).not.toHaveBeenCalled();expect(s.client.read).toHaveBeenCalledTimes(1);s.update({parentDirty:false});expect(screen.getByDisplayValue('Keep parent dirty edit')).toBeVisible();expect(screen.getByText('Save questions')).not.toBeDisabled();
});
it('identity commit hides old host status and fields before layout reset',async()=>{
 const snapshots:string[]=[],s=setup(()=>{snapshots.push(document.querySelector('[aria-label="Local field draft workspace"]')?.textContent??'');});await load();fireEvent.change(screen.getByLabelText('Question label'),{target:{value:'Old secret'}});expect(screen.getByText('Unsaved question changes.')).toBeVisible();snapshots.length=0;s.update({token:'different-owner-token'});expect(snapshots).toHaveLength(1);expect(snapshots[0]).not.toContain('Unsaved question changes.');expect(snapshots[0]).not.toContain('Saved private question');expect(screen.queryByDisplayValue('Old secret')).toBeNull();
});
