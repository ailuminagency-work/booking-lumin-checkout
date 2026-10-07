import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import type {ConditionalCustomerTextField} from '@lumin/contracts';
import {ConnectedConditionalCustomerDraftPreview} from './ConnectedConditionalCustomerDraftPreview';
const fields:ConditionalCustomerTextField[]=[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:30},{id:'custom_notes',kind:'text',label:'Notes',required:true,maxLength:100,when:{fieldId:'custom_access',equals:'Yes'}},{id:'custom_more',kind:'text',label:'More',required:false,maxLength:50,when:{fieldId:'custom_notes',equals:'More'}}];
afterEach(cleanup);
it('evaluates exact earlier-field chains in order and clears hidden descendants instead of resurrecting their values',()=>{render(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant-one" disabled={false}/>);expect(screen.queryByRole('textbox',{name:'Preview value: Notes'})).toBeNull();fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'yes'}});expect(screen.queryByRole('textbox',{name:'Preview value: Notes'})).toBeNull();fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});expect(screen.getByText('Required when visible - maximum 100 characters')).toBeVisible();fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Notes'}),{target:{value:'More'}});fireEvent.change(screen.getByRole('textbox',{name:'Preview value: More'}),{target:{value:'Fictional text'}});expect(screen.getAllByRole('textbox').map(input=>input.getAttribute('aria-describedby'))).toHaveLength(3);fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'No'}});expect(screen.getAllByRole('textbox')).toHaveLength(1);fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});expect(screen.getByRole('textbox',{name:'Preview value: Notes'})).toHaveValue('');expect(screen.queryByRole('textbox',{name:'Preview value: More'})).toBeNull();});
it('clears scenario values synchronously on business context, field order or definition replacement',()=>{const view=render(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant-one" disabled={false}/>);fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});view.rerender(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant-two" disabled={false}/>);expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toHaveValue('');fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});view.rerender(<ConnectedConditionalCustomerDraftPreview fields={[{...fields[0]!,maxLength:10},...fields.slice(1)]} scopeKey="tenant-two" disabled={false}/>);expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toHaveValue('');});
it.each([[{...fields[0]!,when:{fieldId:'custom_notes',equals:'x'}},fields[1]!],[{...fields[0]!,id:'custom_price'}],[{...fields[0]!,extra:'private-value'}],[{...fields[0]!,label:'bad\ud800'}]].map(value=>({value})))('fails closed on invalid configuration without exposing widened data',({value})=>{render(<ConnectedConditionalCustomerDraftPreview fields={value as ConditionalCustomerTextField[]} scopeKey="tenant" disabled={false}/>);expect(screen.getByRole('alert')).toHaveTextContent('Fix the conditional draft configuration');expect(screen.queryByRole('textbox')).toBeNull();expect(document.body.textContent).not.toContain('private-value');});
it('does not retain malformed scenario values, bypass locks, submit, request capabilities or offer customer actions',()=>{const submit=vi.fn();const view=render(<form onSubmit={event=>{event.preventDefault();submit();}}><ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled={false}/></form>);const source=screen.getByRole('textbox',{name:'Preview value: Access'});fireEvent.change(source,{target:{value:'x'.repeat(31)}});expect(source).toHaveValue('');fireEvent.change(source,{target:{value:'bad\u0001'}});expect(source).toHaveValue('');view.rerender(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled/>);fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toBeDisabled();expect(screen.queryByRole('textbox',{name:'Preview value: Notes'})).toBeNull();expect(screen.getByRole('button',{name:'Reset preview scenario'})).toBeDisabled();expect(screen.getByText(/never saved or submitted/)).toBeVisible();expect(submit).not.toHaveBeenCalled();});

it('resets an entire conditional scenario without editing definitions or submitting its parent form',()=>{
 const submit=vi.fn(),before=structuredClone(fields);
 render(<form onSubmit={event=>{event.preventDefault();submit();}}><ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled={false}/></form>);
 const reset=screen.getByRole('button',{name:'Reset preview scenario'});expect(reset).toBeDisabled();
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Notes'}),{target:{value:'More'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: More'}),{target:{value:'Fictional text'}});
 expect(reset).toBeEnabled();fireEvent.click(reset);
 expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toHaveValue('');expect(screen.getAllByRole('textbox')).toHaveLength(1);
 expect(screen.getByRole('status')).toHaveTextContent('Preview scenario cleared. Your draft is unchanged.');expect(reset).toBeDisabled();
 expect(fields).toEqual(before);expect(submit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});
 expect(screen.getByRole('textbox',{name:'Preview value: Notes'})).toHaveValue('');expect(screen.queryByRole('textbox',{name:'Preview value: More'})).toBeNull();expect(screen.queryByRole('status')).toBeNull();
});
it('retains the scenario during a publication lock and permits reset only after unlocking',()=>{
 const view=render(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled={false}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});
 view.rerender(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled/>);
 const reset=screen.getByRole('button',{name:'Reset preview scenario'});expect(reset).toBeDisabled();fireEvent.click(reset);
 expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toHaveValue('Yes');expect(screen.queryByRole('status')).toBeNull();
 view.rerender(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled={false}/>);fireEvent.click(reset);
 expect(screen.getByRole('textbox',{name:'Preview value: Access'})).toHaveValue('');
});
it('clears reset feedback on a business change and never offers a reset for invalid configuration',()=>{
 const view=render(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="tenant" disabled={false}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'Preview value: Access'}),{target:{value:'Yes'}});fireEvent.click(screen.getByRole('button',{name:'Reset preview scenario'}));
 expect(screen.getByRole('status')).toBeVisible();view.rerender(<ConnectedConditionalCustomerDraftPreview fields={fields} scopeKey="other" disabled={false}/>);
 expect(screen.queryByRole('status')).toBeNull();expect(screen.getByRole('button',{name:'Reset preview scenario'})).toBeDisabled();
 view.rerender(<ConnectedConditionalCustomerDraftPreview fields={[{...fields[0]!,id:'invalid'}]} scopeKey="other" disabled={false}/>);
 expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByRole('button')).toBeNull();
});
