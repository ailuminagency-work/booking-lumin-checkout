import { parseFieldDocumentV2, recordV2, listV2, keyV2, rejectV2 } from './fieldDocumentV2';
export interface FieldAnswerDocumentV2 { readonly schemaVersion: 2; readonly answers: readonly Readonly<{key:string;value:string}>[] }
/** Caller must enforce raw request bytes before JSON decoding. This pure contract
 * grants no authority and persists nothing. Exact CRLF counts as two code points.
 */
export function parseFieldAnswersV2(definition: unknown, input: unknown): FieldAnswerDocumentV2 {
  try {
    const fields=parseFieldDocumentV2(definition).fields;
    const document=recordV2(input,['schemaVersion','answers']);
    if(document.schemaVersion!==2)return rejectV2();
    const seen=new Set<string>();let totalUnits=0;
    const answers=listV2(document.answers).map(value=>{
      const item=recordV2(value,['key','value']);const key=keyV2(item.key);
      const field=fields.find(candidate=>candidate.key===key);
      if(!field||seen.has(key)||typeof item.value!=='string'||item.value.length>8192)return rejectV2();
      totalUnits+=item.value.length;if(totalUnits>65536)return rejectV2();
      let count=0;
      for(const character of item.value){
        const code=character.codePointAt(0)!;
        if(code===0||(code>=0xd800&&code<=0xdfff)||(++count>4096))return rejectV2();
        if(field.kind==='text'&&(code===10||code===13||code===0x2028||code===0x2029))return rejectV2();
      }
      const empty=item.value.trim().length===0;
      if(count>field.maxLength||(empty?field.required:count<field.minLength))return rejectV2();
      seen.add(key);return Object.freeze({key,value:item.value});
    });
    if(fields.some(field=>field.required&&!seen.has(field.key)))return rejectV2();
    return Object.freeze({schemaVersion:2 as const,answers:Object.freeze(answers)});
  } catch {return rejectV2();}
}
