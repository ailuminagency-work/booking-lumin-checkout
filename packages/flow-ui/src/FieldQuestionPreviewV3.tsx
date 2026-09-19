import { createElement, useId, useState } from 'react';
import { parseFieldAnswersV3 } from '../../workflow/src/fieldAnswersV3';
import { parseFieldDocumentV3, type FieldDocumentV3 } from '../../workflow/src/fieldDocumentV3';
export interface FieldQuestionPreviewV3Props { definition: unknown; resetKey?: object }
/** Owner-only rehearsal. No submission, persistence, pricing or public runtime. Textarea values follow native DOM newline semantics; the parser receives their exact value. */
export function FieldQuestionPreviewV3({ definition, resetKey }: FieldQuestionPreviewV3Props) {
  let document: FieldDocumentV3 | undefined;
  try { document = parseFieldDocumentV3(definition); } catch { /* Invalid definitions expose no answer controls. */ }
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
      parseFieldAnswersV3(parsed,{schemaVersion:3,answers:parsed.fields.filter(field=>Object.hasOwn(current.answers,field.key)).map(field=>({key:field.key,value:current.answers[field.key]}))});
      setState({...current,outcome:'valid'});
    } catch { setState({...current,outcome:'invalid'}); }
  }
  function fieldInvalid(key: string) {
    if(current.outcome !== 'invalid') return false;
    try { parseFieldAnswersV3({schemaVersion:3,fields:parsed.fields.filter(field=>field.key===key)}, {schemaVersion:3,answers:Object.hasOwn(current.answers,key)?[{key,value:current.answers[key]}]:[]}); return false; } catch {return true;}
  }
  return <section aria-label="Question preview">
    <h3>Try your questions</h3><p>Preview only. These answers are not saved or submitted.</p>
    {parsed.fields.map((field,index) => <div key={field.key}>
      <label htmlFor={`${prefix}-${index}`}>{field.prompt ?? 'Question needs a label'}</label>
      <p id={`${prefix}-${index}-help`}>{field.required ? 'Answer required.' : 'Answer optional.'} {field.kind === 'dropdown' ? 'Choose one option.' : `Minimum ${field.minLength}, maximum ${field.maxLength} characters.`}</p>
      {createElement(field.kind === 'dropdown' ? 'select' : field.kind === 'textarea' ? 'textarea' : 'input', {
        id: `${prefix}-${index}`, ...(field.kind === 'text' ? {type: 'text'} : field.kind === 'textarea' ? {rows: 4} : {}),
        'aria-required': field.required, 'aria-invalid': fieldInvalid(field.key),
        'aria-describedby': `${prefix}-${index}-help${fieldInvalid(field.key) ? ` ${prefix}-${index}-error` : ''}`,
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { if(field.kind !== 'textarea' && event.key === 'Enter') event.preventDefault(); },
        value: Object.hasOwn(current.answers,field.key) ? current.answers[field.key] : '',
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
          const value=event.target.value;
          const total = Object.entries(current.answers).reduce((sum,[key,answer])=>sum+(key===field.key?0:answer.length),value.length);
          if(value.length<=8192 && total<=65536) {
            const answers={...current.answers};
            if(field.kind==='dropdown' && value==='')delete answers[field.key];
            else answers[field.key]=value;
            setState({...current,answers,outcome:''});
          }
        }
      }, ...(field.kind==='dropdown' ? [<option key="empty" value="">Choose an option</option>, ...field.choices.map(choice=><option key={`choice-${choice.id}`} value={choice.id}>{choice.label}</option>)] : []))}
      {fieldInvalid(field.key) && <p id={`${prefix}-${index}-error`}>{field.kind==='dropdown' ? 'Choose an available option.' : 'Check this answer and its character limits.'}</p>}
    </div>)}
    <button type="button" onClick={validate}>Check answers</button>
    {current.outcome==='valid' && <p role="status">Preview answers are valid. Nothing was submitted.</p>}
    {current.outcome==='invalid' && <p role="alert">Check required answers, character limits and selected options.</p>}
  </section>;
}
