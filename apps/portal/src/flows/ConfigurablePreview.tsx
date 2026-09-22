import {useState,type FormEvent} from 'react';
import {ConfigurableQuestionForm,canonicalConfigurableAnswers,type ConfigurableRender,type Answers} from '@lumin/flow-ui';

/** Local question validation only: deliberately has no transport or owner context. */
export function ConfigurablePreview({render,answers,onChange}:{render:ConfigurableRender;answers:Answers;onChange:(answers:Answers)=>void}){
 const fingerprint=JSON.stringify([render,answers]);
 const [previous,setPrevious]=useState(fingerprint);
 const [result,setResult]=useState<'valid'|'invalid'>();
 // Invalidate before commit, not in an effect that could briefly show stale success.
 if(previous!==fingerprint){setPrevious(fingerprint);if(result)setResult(undefined);}
 function check(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setResult(undefined);
  if(!event.currentTarget.checkValidity()){setResult('invalid');event.currentTarget.reportValidity();event.currentTarget.querySelector<HTMLElement>('input:invalid, select:invalid, textarea:invalid')?.focus();return;}
  try{canonicalConfigurableAnswers(render,answers);setResult('valid');}catch{setResult('invalid');}
 }
 return <section aria-label="Question preview"><h3>Customer question preview</h3><p>Question preview only. Answers are not saved or submitted.</p>
  <form aria-label="Check preview answers" noValidate onSubmit={check}>
   <ConfigurableQuestionForm render={render} answers={answers} onChange={next=>{setResult(undefined);onChange(next);}}/>
   <button type="submit">Check these answers</button>
   <button type="button" onClick={()=>{setResult(undefined);onChange({});}}>Start preview again</button>
   {result==='valid'&&<p role="status">These answers are valid for this preview.</p>}
   {result==='invalid'&&<p role="alert">Complete the required questions and check the allowed answers and quantities.</p>}
  </form>
 </section>;
}