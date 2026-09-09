import {useEffect,useRef,useId} from 'react';
import {type Answers,type ServiceRender} from './types';
import {type ConfigurableRender,visibleSteps,clearHiddenAnswers} from './configurable';
// Both versions share controls; the adapter decides visibility and requiredness.
export function QuestionControls({questions,answers,onChange,disabled=false}:{questions:ServiceRender['questions'];answers:Answers;onChange:(next:Answers)=>void;disabled?:boolean}){
 return <div>{questions.map(q=><QuestionControl key={q.id} q={q} answers={answers} disabled={disabled} onChange={onChange}/>)}</div>;
}
function QuestionControl({q,answers,onChange,disabled}:{q:ServiceRender['questions'][number];answers:Answers;onChange:(next:Answers)=>void;disabled:boolean}){
 const a=Object.hasOwn(answers,q.id)?answers[q.id]:undefined;const first=useRef<HTMLInputElement>(null),errorId=useId();const missing=q.required&&q.kind==='multi_choice'&&!a?.choiceIds?.length;
 useEffect(()=>{first.current?.setCustomValidity(missing?'Choose at least one option.':'');},[missing]);
 const set=(value:Answers[string]|undefined)=>{const next={...answers};if(value)Object.defineProperty(next,q.id,{value,enumerable:true,writable:true,configurable:true});else delete next[q.id];onChange(next);};
 return <fieldset disabled={disabled}><legend>{q.prompt}{q.required?' (required)':' (optional)'}</legend>{q.kind==='quantity'?<label>Quantity<input required={q.required} type="number" aria-label={q.prompt} min={q.minQty??0} max={q.maxQty??10000} step="1" value={a?.quantity??''} onChange={e=>set(e.target.value===''?undefined:{quantity:Number(e.target.value)})}/></label>:q.kind==='single_choice'?<select required={q.required} aria-label={q.prompt} value={a?.choiceIds?.[0]??''} onChange={e=>set(e.target.value?{choiceIds:[e.target.value]}:undefined)}><option value="">Choose an answer</option>{q.choices.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>:<>{q.choices.map((c,i)=><label key={c.id} style={{display:'block'}}><input ref={i===0?first:undefined} type="checkbox" aria-describedby={missing?errorId:undefined} aria-invalid={missing||undefined} checked={a?.choiceIds?.includes(c.id)??false} onChange={e=>{const ids=e.target.checked?[...(a?.choiceIds??[]),c.id]:(a?.choiceIds??[]).filter(id=>id!==c.id);set(ids.length?{choiceIds:ids}:undefined);}}/>{c.label}</label>)}{missing&&<p id={errorId}>Choose at least one option.</p>}</>}</fieldset>;
}
export function ConfigurableQuestionForm({render,answers,onChange,disabled=false}:{render:ConfigurableRender;answers:Answers;onChange:(next:Answers)=>void;disabled?:boolean}){
 const questions=visibleSteps(render,answers).map(step=>({...render.service.questions.find(q=>q.id===step.questionKey)!,required:step.required}));
 return <QuestionControls questions={questions} answers={answers} disabled={disabled} onChange={next=>onChange(clearHiddenAnswers(render,next))}/>;
}
