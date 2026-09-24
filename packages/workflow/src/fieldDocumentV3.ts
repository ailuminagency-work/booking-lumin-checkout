import { keyV2, listV2, parseFieldDocumentV2, recordV2, type FieldV2 } from './fieldDocumentV2';

export interface FieldChoiceV3 { readonly id: string; readonly label: string }
export interface DropdownFieldV3 {
  readonly key: string; readonly kind: 'dropdown'; readonly required: boolean;
  readonly prompt?: string; readonly choices: readonly FieldChoiceV3[];
}
export type FieldV3 = FieldV2 | DropdownFieldV3;
export interface FieldDocumentV3 { readonly schemaVersion: 3; readonly fields: readonly FieldV3[] }
const reject = (): never => { throw new Error('INVALID_FIELD_V3_CONTRACT'); };

// Delegate metadata validation to the unchanged V2 parser, preserving its exact
// code-point, whitespace, descriptor and plain-text policy without normalization.
function metadata(value: unknown): string {
  return parseFieldDocumentV2({schemaVersion:2,fields:[{key:'metadata',kind:'text',required:false,minLength:0,maxLength:0,prompt:value}]}).fields[0]!.prompt!;
}
/** Pure non-commerce contract only. No persistence, conversion, pricing, authorization
 * or publication is enabled. Callers must bound raw bytes before JSON decoding.
 * Proxy traps can run during reflection; their failures reject. Getters are never read.
 */
export function parseFieldDocumentV3(input: unknown): FieldDocumentV3 {
  try {
    const document=recordV2(input,['schemaVersion','fields']);
    if(document.schemaVersion!==3)return reject();
    const seen=new Set<string>();let totalChoices=0;
    const fields:FieldV3[]=listV2(document.fields).map(value=>{
      const header=recordV2(value,['key','kind','required'],['prompt','minLength','maxLength','choices']);
      const key=keyV2(header.key);
      if(seen.has(key))return reject();
      seen.add(key);
      if(header.kind==='text'||header.kind==='textarea')return parseFieldDocumentV2({schemaVersion:2,fields:[header]}).fields[0]!;
      if(header.kind!=='dropdown')return reject();
      const field=recordV2(header,['key','kind','required','choices'],['prompt']);
      if(typeof field.required!=='boolean')return reject();
      const values=listV2(field.choices);
      if(values.length<1||values.length>32||(totalChoices+=values.length)>256)return reject();
      const ids=new Set<string>();
      const choices=values.map(value=>{
        const choice=recordV2(value,['id','label']);const id=keyV2(choice.id);
        if(ids.has(id))return reject();ids.add(id);
        return Object.freeze({id,label:metadata(choice.label)});
      });
      return Object.freeze({key,kind:'dropdown' as const,required:field.required,
        ...('prompt' in field?{prompt:metadata(field.prompt)}:{}),choices:Object.freeze(choices)});
    });
    return Object.freeze({schemaVersion:3 as const,fields:Object.freeze(fields)});
  } catch {return reject();}
}
