import { useId, useState } from 'react';
import { parseTextAnswers, parseTextFieldDocument, type TextFieldDocument } from '../../workflow/src/fieldAnswers';
export interface TextQuestionPreviewProps { definition: unknown; resetKey?: object }
/** Owner-only rehearsal. No submission, persistence, pricing or public runtime. */
export function TextQuestionPreview({ definition, resetKey }: TextQuestionPreviewProps) {
  let document: TextFieldDocument | undefined;
  try { document = parseTextFieldDocument(definition); } catch { /* Invalid definitions expose no answer controls. */ }
  const signature = document ? JSON.stringify(document) : null;
  const prefix = useId();
  const [state, setState] = useState<{signature: string | null; resetKey?: object; answers: Record<string,string>; outcome: ''|'valid'|'invalid'}>(() => ({signature,resetKey,answers:{},outcome:''}));
  // Render-gated reset prevents an old context's answers appearing even for one commit.
  let current = state;
  if (state.signature !== signature || state.resetKey !== resetKey) {
    current = {signature,resetKey,answers:{},outcome:''}; setState(current);
  }
  if (!document) return <section aria-label="Question preview"><p role="alert">This question preview is unavailable.</p></section>;
  const parsed = document;
  function validate() {
    try {
      parseTextAnswers(parsed,{schemaVersion:1,answers:parsed.fields.filter(field=>Object.hasOwn(current.answers,field.key)).map(field=>({key:field.key,value:current.answers[field.key]}))});
      setState({...current,outcome:'valid'});
    } catch { setState({...current,outcome:'invalid'}); }
  }
  function fieldInvalid(key: string) {
    if(current.outcome !== 'invalid') return false;
    try { parseTextAnswers({schemaVersion:1,fields:parsed.fields.filter(field=>field.key===key)}, {schemaVersion:1,answers:Object.hasOwn(current.answers,key)?[{key,value:current.answers[key]}]:[]}); return false; } catch {return true;}
  }
  return <section aria-label="Question preview">
    <h3>Try your text questions</h3><p>Preview only. These answers are not saved or submitted.</p>
    {parsed.fields.map((field,index) => <div key={field.key}>
      <label htmlFor={`${prefix}-${index}`}>{field.prompt ?? 'Question needs a label'}</label>
      <p id={`${prefix}-${index}-help`}>{field.required ? 'Answer required.' : 'Answer optional.'} Minimum {field.minLength}, maximum {field.maxLength} characters.</p>
      <input id={`${prefix}-${index}`} type="text" aria-required={field.required} aria-invalid={fieldInvalid(field.key)} aria-describedby={`${prefix}-${index}-help${fieldInvalid(field.key) ? ` ${prefix}-${index}-error` : ''}`} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} value={Object.hasOwn(current.answers,field.key) ? current.answers[field.key] : ''} onChange={event=>{
        const value=event.target.value;
        if(value.length<=8192)setState({...current,answers:{...current.answers,[field.key]:value},outcome:''});
      }}/>
      {fieldInvalid(field.key) && <p id={`${prefix}-${index}-error`}>Check this answer and its character limits.</p>}
    </div>)}
    <button type="button" onClick={validate}>Check answers</button>
    {current.outcome==='valid' && <p role="status">Preview answers are valid. Nothing was submitted.</p>}
    {current.outcome==='invalid' && <p role="alert">Check required answers and character limits.</p>}
  </section>;
}
