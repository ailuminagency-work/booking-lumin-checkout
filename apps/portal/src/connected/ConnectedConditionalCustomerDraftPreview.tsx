import {useId,useState} from 'react';
import {ConditionalCustomerFieldConfiguration,resolveConditionalCustomerFieldVisibility,type ConditionalCustomerTextField} from '@lumin/contracts';
type Props={fields:readonly ConditionalCustomerTextField[];scopeKey:string;disabled:boolean};
/** Fictional local scenario values only: no customer session, persistence or submission. */
export function ConnectedConditionalCustomerDraftPreview({fields,scopeKey,disabled}:Props){
 const parsed=ConditionalCustomerFieldConfiguration.safeParse({schemaVersion:3,customerFields:fields});
 if(!parsed.success)return <section aria-label="Conditional draft preview"><p role="alert">Fix the conditional draft configuration before previewing it. No saved or published form was changed.</p></section>;
 return <Scenario key={JSON.stringify([scopeKey,parsed.data])} fields={parsed.data.customerFields} disabled={disabled}/>;
}
function Scenario({fields,disabled}:{fields:ConditionalCustomerTextField[];disabled:boolean}){
 const [values,setValues]=useState<Record<string,string>>({}),id=useId();
 const configuration={schemaVersion:3,customerFields:fields};
 const visible=resolveConditionalCustomerFieldVisibility(configuration,values);
 function change(fieldId:string,value:string){if(disabled)return;const candidates={...values,[fieldId]:value},next:Record<string,string>={};for(const field of fields){const shown=!field.when||(Object.hasOwn(next,field.when.fieldId)&&next[field.when.fieldId]===field.when.equals);if(shown&&Object.hasOwn(candidates,field.id))next[field.id]=candidates[field.id]!;}try{resolveConditionalCustomerFieldVisibility(configuration,next);setValues(next);}catch{/* Invalid local scenario text is not retained. */}}
 return <section aria-label="Conditional draft preview" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}><h3>Unpublished conditional draft preview</h3><p>Enter fictional local preview values to check exact-match visibility. These values are not customer answers and are never saved or submitted. This preview does not publish, start a session, check availability or enable payment.</p><fieldset disabled={disabled} className="form-stack" style={{minWidth:0}}><legend>Local visibility scenario</legend>{fields.filter(field=>visible.includes(field.id)).map(field=><div key={field.id} style={{minWidth:0}}><label style={{display:"grid",gap:6,minWidth:0}}>Preview value: {field.label}<input style={{boxSizing:"border-box",width:"100%",maxWidth:"100%",minWidth:0,minHeight:44}} type="text" value={values[field.id]??''} maxLength={field.maxLength} autoComplete="off" aria-describedby={id+'-'+field.id} onChange={event=>change(field.id,event.target.value)}/></label><p id={id+'-'+field.id}>{field.required?'Required when visible':'Optional'} - maximum {field.maxLength} characters</p></div>)}</fieldset><p>Visible draft fields in order: {fields.filter(field=>visible.includes(field.id)).map(field=>field.label).join(', ')||'none'}.</p><p>Hidden field preview values are cleared when their condition stops matching. Changing the draft or business context clears all scenario values.</p></section>;
}
