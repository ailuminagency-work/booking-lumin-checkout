/** Fixed expected outcomes, independent of either parser. JSON wire cases only. */
export const SEMANTIC_COUNT=167;
export const STORAGE_LIMIT_COUNT=2;
export const WIRE_REJECT_COUNT=3;
export interface SemanticCase {name:string;input:unknown;accepted:boolean}
export function baseEnvelope(){return {fieldPublicationVersion:1,tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',flowId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',versionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',parentAuthoringVersion:2,sourceParentRevision:1,sourceFieldDraftRevision:2,submissionMode:'unconfirmed_request',definition:{schemaVersion:3,fields:[{key:'choice',kind:'dropdown',required:true,prompt:' Exact prompt ',choices:[{id:'second',label:' Same '},{id:'first',label:' Same '}]}]}};}
function choices(count:number,label='Choice'){return Array.from({length:count},(_,i)=>({id:'c'+i,label}));}
function dropdown(key:string,count:number,label='Choice'){return {key,kind:'dropdown',required:false,choices:choices(count,label)};}
function withDefinition(definition:unknown){return {...baseEnvelope(),definition};}
function metadata(value:string,where:'prompt'|'label') {const input=baseEnvelope();if(where==='prompt')input.definition.fields[0]!.prompt=value;else input.definition.fields[0]!.choices[0]!.label=value;return input;}
export function semanticCases():SemanticCase[]{
 const out:SemanticCase[]=[{name:'canonical-exact-duplicate-label-order',input:baseEnvelope(),accepted:true}];
 for(const key of ['fieldPublicationVersion','tenantId','flowId','versionId','parentAuthoringVersion','sourceParentRevision','sourceFieldDraftRevision','definition','submissionMode']){
  const missing:Record<string,unknown>={...baseEnvelope()};delete missing[key];out.push({name:key+'-missing',input:missing,accepted:false});
  for(const [label,value] of [['null',null],['array',[]],['boolean',false],['wrong-string','wrong']] as const)out.push({name:key+'-'+label,input:{...baseEnvelope(),[key]:value},accepted:false});
 }
 for(const [key,values] of [['fieldPublicationVersion',[0,2,'1']],['parentAuthoringVersion',[1,3,'2']],['submissionMode',['confirmed_booking','','UNCONFIRMED_REQUEST']]] as const)for(const [i,value] of values.entries())out.push({name:key+'-discriminator-'+i,input:{...baseEnvelope(),[key]:value},accepted:false});
 for(const key of ['tenantId','flowId','versionId'] as const){
  const original=baseEnvelope()[key];
  for(const [label,value,accepted] of [['short','a',false],['braced','{'+original+'}',false],['no-hyphens',original.replaceAll('-',''),false],['nonhex','g'+original.slice(1),false],['leading-space',' '+original,false],['trailing-space',original+' ',false],['newline',original+'\n',false],['uppercase',original.toUpperCase(),true],['nil','00000000-0000-0000-0000-000000000000',true]] as const)out.push({name:key+'-'+label,input:{...baseEnvelope(),[key]:value},accepted});
 }
 for(const key of ['sourceParentRevision','sourceFieldDraftRevision'])for(const [label,value,accepted] of [['negative',-1,false],['zero',0,false],['fraction',0.5,false],['unsafe',Number.MAX_SAFE_INTEGER+1,false],['numeric-string','1',false],['one',1,true],['safe-maximum',Number.MAX_SAFE_INTEGER,true]] as const)out.push({name:key+'-'+label,input:{...baseEnvelope(),[key]:value},accepted});
 const text=(length:number)=>Array.from({length},(_,i)=>({key:'text'+i,kind:'text',required:false,minLength:0,maxLength:100}));
 const total=(count:number)=>Array.from({length:Math.ceil(count/32)},(_,i)=>dropdown('q'+i,Math.min(32,count-i*32)));
 for(const [name,definition,accepted] of [
  ['definition-v2',{schemaVersion:2,fields:[]},false],['fields-missing',{schemaVersion:3},false],['fields-null',{schemaVersion:3,fields:null},false],['fields-object',{schemaVersion:3,fields:{}},false],['fields-empty',{schemaVersion:3,fields:[]},true],
  ['fields64',{schemaVersion:3,fields:text(64)},true],['fields65',{schemaVersion:3,fields:text(65)},false],
  ['choices1',{schemaVersion:3,fields:[dropdown('q',1)]},true],['choices32',{schemaVersion:3,fields:[dropdown('q',32)]},true],['choices33',{schemaVersion:3,fields:[dropdown('q',33)]},false],['choices0',{schemaVersion:3,fields:[dropdown('q',0)]},false],
  ['total256',{schemaVersion:3,fields:total(256)},true],['total257',{schemaVersion:3,fields:total(257)},false],
 ] as const)out.push({name,input:withDefinition(definition),accepted});
 for(const where of ['prompt','label'] as const)for(const [name,value,accepted] of [
  ['empty','',false],['space',' ',false],['tab','\t',false],['nbsp','\u00a0',false],['zero-width','\u200b',true],['combining',' e\u0301 ',true],['scalar200','a'.repeat(200),true],['scalar201','a'.repeat(201),false],['astral200','\u{1f600}'.repeat(200),true],['astral201','\u{1f600}'.repeat(201),false],['newline','a\nb',false],['carriage','a\rb',false],['line-separator','a\u2028b',false],['paragraph-separator','a\u2029b',false],['next-line','a\u0085b',true],['markup',' <b>Exact</b> ',true],['padded','  Exact  ',true],['emoji','\u{1f680}',true],
 ] as const)out.push({name:where+'-'+name,input:metadata(value,where),accepted});
 const extra=baseEnvelope();
 out.push({name:'extra-envelope',input:{...extra,authorized:true},accepted:false},{name:'extra-definition',input:withDefinition({...extra.definition,price:1}),accepted:false},{name:'extra-field',input:withDefinition({schemaVersion:3,fields:[{...extra.definition.fields[0],price:1}]}),accepted:false},{name:'extra-choice',input:withDefinition({schemaVersion:3,fields:[{...extra.definition.fields[0],choices:[{id:'ok',label:'Choice',price:1}]}]}),accepted:false});
 out.push({name:'duplicate-field-identity',input:withDefinition({schemaVersion:3,fields:[dropdown('same',1),dropdown('same',1)]}),accepted:false},{name:'duplicate-choice-identity',input:withDefinition({schemaVersion:3,fields:[{...dropdown('q',1),choices:[{id:'same',label:'One'},{id:'same',label:'Two'}]}]}),accepted:false});
 for(const target of ['field','choice'] as const)for(const [name,id,accepted] of [['reserved','constructor',false],['bad-start','_start',false],['newline','a\n',false],['length64','a'.repeat(64),true],['length65','a'.repeat(65),false]] as const){const input=baseEnvelope();if(target==='field')input.definition.fields[0]!.key=id;else input.definition.fields[0]!.choices[0]!.id=id;out.push({name:target+'-identity-'+name,input,accepted});}
 const short={key:'short',kind:'text',required:false,minLength:0,maxLength:10};
 out.push({name:'mixed-text-textarea-dropdown',input:withDefinition({schemaVersion:3,fields:[short,{...short,key:'long',kind:'textarea'},dropdown('pick',2)]}),accepted:true},{name:'reversed-text-limits',input:withDefinition({schemaVersion:3,fields:[{...short,minLength:11}]}),accepted:false},{name:'missing-text-limit',input:withDefinition({schemaVersion:3,fields:[{key:'q',kind:'text',required:false,minLength:0}]}),accepted:false});
 out.push({name:'null-choices',input:withDefinition({schemaVersion:3,fields:[{...dropdown('q',1),choices:null}]}),accepted:false},{name:'null-choice-label',input:withDefinition({schemaVersion:3,fields:[{...dropdown('q',1),choices:[{id:'c',label:null}]}]}),accepted:false},{name:'null-required',input:withDefinition({schemaVersion:3,fields:[{...dropdown('q',1),required:null}]}),accepted:false});
 return out;
}
export function storageLimitCases(){return [
 {name:'definition-bytes-only',input:withDefinition({schemaVersion:3,fields:Array.from({length:8},(_,i)=>dropdown('q'+i,32,'a'.repeat(200)))}),envelopeExceedsLimit:false},
 {name:'definition-and-envelope-bytes-overlap',input:withDefinition({schemaVersion:3,fields:Array.from({length:8},(_,i)=>dropdown('q'+i,32,'\u{1f600}'.repeat(200)))}),envelopeExceedsLimit:true},
 ];}
export function wireRejectCases(){return [{name:'nul',sqlstate:'22P05',input:metadata('a\u0000b','label')},{name:'lone-high-surrogate',sqlstate:'22P02',input:metadata('a\ud800b','label')},{name:'lone-low-surrogate',sqlstate:'22P02',input:metadata('a\udc00b','label')}];}
