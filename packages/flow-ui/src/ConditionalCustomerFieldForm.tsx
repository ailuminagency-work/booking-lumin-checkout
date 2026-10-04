import {useId,type CSSProperties} from 'react';
import {ConditionalCustomerFieldConfiguration,resolveConditionalCustomerFieldVisibility,type ConditionalCustomerFieldAnswers} from '@lumin/contracts';

/** An explicit edit may deactivate descendants. Remove those values here, before
 * submitting; the server canonicalizer still rejects every hidden answer. */
export function editConditionalCustomerAnswer(configuration:unknown,current:unknown,fieldId:string,value:string):ConditionalCustomerFieldAnswers{
 const parsed=ConditionalCustomerFieldConfiguration.parse(configuration);
 const visible=resolveConditionalCustomerFieldVisibility(parsed,current);
 if(!visible.includes(fieldId))throw Error('INVALID_CONDITIONAL_CUSTOMER_EDIT');
 const candidates={...(current as ConditionalCustomerFieldAnswers),[fieldId]:value};
 const next:ConditionalCustomerFieldAnswers={};
 for(const field of parsed.customerFields){
  if(resolveConditionalCustomerFieldVisibility(parsed,next).includes(field.id)&&Object.hasOwn(candidates,field.id))next[field.id]=candidates[field.id]!;
 }
 resolveConditionalCustomerFieldVisibility(parsed,next);
 return next;
}

const inputStyle:CSSProperties={display:'block',width:'100%',minWidth:0,maxWidth:'100%'};
export function ConditionalCustomerFieldForm({configuration,answers,onChange,disabled=false}:{configuration:unknown;answers:unknown;onChange:(answers:ConditionalCustomerFieldAnswers)=>void;disabled?:boolean}){
 const prefix=useId();
 const parsed=ConditionalCustomerFieldConfiguration.safeParse(configuration);
 let visible:string[]=[];
 try{if(parsed.success)visible=resolveConditionalCustomerFieldVisibility(parsed.data,answers);}catch{return <p role="alert">The additional information form is unavailable. Reload the booking form.</p>;}
 if(!parsed.success)return <p role="alert">The additional information form is unavailable. Reload the booking form.</p>;
 const values=answers as ConditionalCustomerFieldAnswers;
 return <fieldset disabled={disabled} style={{minWidth:0}}><legend>Additional information</legend>{parsed.data.customerFields.filter(field=>visible.includes(field.id)).map(field=><div key={field.id}><label htmlFor={`${prefix}-${field.id}`}>{field.label}{!field.required&&<span> (optional)</span>}</label><input id={`${prefix}-${field.id}`} style={inputStyle} type="text" autoComplete="off" required={field.required} maxLength={field.maxLength} value={values[field.id]??''} onChange={event=>onChange(editConditionalCustomerAnswer(parsed.data,values,field.id,event.target.value))}/></div>)}</fieldset>;
}
