import { keyV2, listV2, recordV2 } from './fieldDocumentV2';
import { parseFieldAnswersV2 } from './fieldAnswersV2';
import { parseFieldDocumentV3 } from './fieldDocumentV3';

export interface FieldAnswerDocumentV3 { readonly schemaVersion: 3; readonly answers: readonly Readonly<{key:string;value:string}>[] }
const reject = (): never => { throw new Error('INVALID_FIELD_V3_CONTRACT'); };
/** Exact answers only, never a Selection or customer/tenant authority. Optional
 * dropdowns are omitted when unanswered, not represented by an empty string.
 * Raw bytes must be bounded before decoding by a future transport. No transport exists here.
 */
export function parseFieldAnswersV3(definition: unknown,input: unknown): FieldAnswerDocumentV3 {
  try {
    const fields=parseFieldDocumentV3(definition).fields;
    const document=recordV2(input,['schemaVersion','answers']);
    if(document.schemaVersion!==3)return reject();
    const seen=new Set<string>();let totalUnits=0;
    const answers=listV2(document.answers).map(value=>{
      const answer=recordV2(value,['key','value']);const key=keyV2(answer.key);
      const field=fields.find(candidate=>candidate.key===key);
      if(!field||seen.has(key)||typeof answer.value!=='string'||answer.value.length>8192)return reject();
      totalUnits+=answer.value.length;if(totalUnits>65536)return reject();
      if(field.kind==='dropdown'){
        if(!field.choices.some(choice=>choice.id===answer.value))return reject();
      } else {
        parseFieldAnswersV2({schemaVersion:2,fields:[field]},{schemaVersion:2,answers:[{key,value:answer.value}]});
      }
      seen.add(key);return Object.freeze({key,value:answer.value});
    });
    if(fields.some(field=>field.required&&!seen.has(field.key)))return reject();
    return Object.freeze({schemaVersion:3 as const,answers:Object.freeze(answers)});
  } catch {return reject();}
}
