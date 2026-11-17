import {afterEach,expect,it} from 'vitest';
import type {CustomerDraftTextField} from '@lumin/contracts';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {type ServiceRow} from '@lumin/runtime-client';
import {PaidSimpleDraftPreview} from './PaidSimpleDraftPreview';
const service:ServiceRow={id:'33333333-3333-4333-8333-333333333333',tenant_id:'11111111-1111-4111-8111-111111111111',name:'Housekeeping',currency:'USD',duration_minutes:60,base_price:12500,active:true};
const presentation={accentColor:'#0f766e',layout:'compact'} as const;
afterEach(cleanup);
it('labels a local unpublished preview and disables all customer controls without a submission form',()=>{
 render(<PaidSimpleDraftPreview name="Local design" presentation={presentation} service={service} catalogLoading={false}/>);
 expect(screen.getByRole('heading',{name:'Unpublished presentation preview'})).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Local design'})).toHaveStyle({color:'#0f766e'});
 expect(screen.getByText('Current catalog price: $125.00')).toBeTruthy();
 for(const label of ['Your name','Email','Requested date','Available time'])expect(screen.getByLabelText(label)).toBeDisabled();
 expect(screen.getByRole('button',{name:'Send unconfirmed request'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Send unconfirmed request'})).toHaveAttribute('type','button');
 expect(document.querySelector('form')).toBeNull();
 expect(screen.getByRole('group',{name:'Disabled booking preview'})).toHaveStyle({gap:'8px'});
});
it('uses labeled native keyboard-focusable radio controls and bounds every device frame within a narrow owner container',()=>{
 render(<div style={{width:240}}><PaidSimpleDraftPreview name={'x'.repeat(200)} presentation={presentation} service={service} catalogLoading={false}/></div>);
 const radios=screen.getAllByRole('radio');expect(radios).toHaveLength(3);
 expect(new Set(radios.map(radio=>radio.getAttribute('name'))).size).toBe(1);
 for(const [label,width] of [['Mobile 320',320],['Tablet 768',768],['Desktop 1024',1024]] as const){
  const radio=screen.getByRole('radio',{name:label});radio.focus();expect(radio).toHaveFocus();fireEvent.click(radio);expect(radio).toBeChecked();
  expect(screen.getByLabelText('Presentation preview frame')).toHaveStyle({width:width+'px',maxWidth:'100%',minWidth:'0',boxSizing:'border-box',overflowWrap:'anywhere'});
 }
 expect(screen.getByText(/does not simulate a separate device/)).toBeTruthy();
});
it('refreshes current catalog display and removes stale price and title when catalog availability changes',()=>{
 const {rerender}=render(<PaidSimpleDraftPreview name="Design" presentation={presentation} service={service} catalogLoading={false}/>);
 rerender(<PaidSimpleDraftPreview name="Design" presentation={{...presentation,layout:'stacked'}} service={{...service,name:'Updated service',base_price:15000}} catalogLoading={false}/>);
 expect(screen.getByText('Service: Updated service')).toBeTruthy();expect(screen.getByText('Current catalog price: $150.00')).toBeTruthy();expect(screen.queryByText('Current catalog price: $125.00')).toBeNull();expect(screen.getByRole('group',{name:'Disabled booking preview'})).toHaveStyle({gap:'16px'});
 rerender(<PaidSimpleDraftPreview name="Design" presentation={presentation} service={service} catalogLoading/>);
 expect(screen.getByText(/unverified while the catalog loads/)).toBeTruthy();expect(screen.queryByText(/Current catalog price:/)).toBeNull();expect(screen.queryByText('Service: Housekeeping')).toBeNull();
 rerender(<PaidSimpleDraftPreview name="Design" presentation={presentation} catalogLoading={false}/>);
 expect(screen.getByText(/unavailable or unverified/)).toBeTruthy();expect(screen.queryByText(/Current catalog price:/)).toBeNull();
});
const fields:CustomerDraftTextField[]=[{id:'custom_access',kind:'text',label:'Access instructions',required:true,maxLength:20},{id:'custom_notes',kind:'text',label:'Additional notes',required:false,maxLength:80}];
it('previews exact draft field order and constraints without collecting customer answers or enabling a form',()=>{
 const {rerender}=render(<PaidSimpleDraftPreview name="Fields" presentation={presentation} service={service} catalogLoading={false} customerFields={fields}/>);
 expect(screen.getByLabelText('Access instructions')).toBeDisabled();expect(screen.getByLabelText('Access instructions')).toBeRequired();expect(screen.getByLabelText('Access instructions')).toHaveAttribute('maxlength','20');expect(screen.getByLabelText('Additional notes')).not.toBeRequired();
 expect(screen.getByLabelText('Access instructions')).toHaveAccessibleDescription('Required · Up to 20 characters');
 expect(screen.getAllByRole('textbox').map(input=>input.closest('label')?.textContent)).toEqual(['Your name','Email','Access instructions','Additional notes']);
 expect(screen.getByLabelText('Access instructions')).toHaveValue('');expect(document.querySelector('form')).toBeNull();
 rerender(<PaidSimpleDraftPreview name="Fields" presentation={presentation} service={service} catalogLoading={false} customerFields={[fields[1]!,{...fields[0]!,label:'Updated access',required:false,maxLength:12}]}/>);
 expect(screen.queryByLabelText('Access instructions')).toBeNull();expect(screen.getAllByRole('textbox').map(input=>input.closest('label')?.textContent)).toEqual(['Your name','Email','Additional notes','Updated access']);expect(screen.getByLabelText('Updated access')).toHaveAttribute('maxlength','12');expect(screen.getByLabelText('Updated access')).not.toBeRequired();
 rerender(<PaidSimpleDraftPreview name="Legacy" presentation={presentation} service={service} catalogLoading={false}/>);expect(screen.queryByLabelText('Additional notes')).toBeNull();expect(screen.queryByLabelText('Updated access')).toBeNull();
});
it.each([[{...fields[0],id:'custom_price'}],[fields[0],fields[0]],[{...fields[0],label:'Bad\ud800'}],[{...fields[0],label:'Bad\u0085label'}],[{...fields[0],maxLength:1001}],[{...fields[0],total:1}]].map(customerFields=>({customerFields})))('clears previous fields and fails closed for invalid draft metadata %j',({customerFields})=>{
 const {rerender}=render(<PaidSimpleDraftPreview name="Fields" presentation={presentation} catalogLoading={false} customerFields={fields}/>);
 expect(screen.getByLabelText('Access instructions')).toBeTruthy();rerender(<PaidSimpleDraftPreview name="Fields" presentation={presentation} catalogLoading={false} customerFields={customerFields as CustomerDraftTextField[]}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Fix the informational fields');expect(screen.queryByLabelText('Access instructions')).toBeNull();expect(screen.queryByLabelText('Additional notes')).toBeNull();expect(screen.getByRole('button',{name:'Send unconfirmed request'})).toBeDisabled();expect(document.querySelector('form')).toBeNull();
});
