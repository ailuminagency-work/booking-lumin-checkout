import {describe,it,expect} from 'vitest';
import {PaidJourney,validatePaidJourney} from '../src/paidJourney';

const kinds=['service','options','schedule','information','review_payment','confirmation'] as const;
const defaultJourney=()=>({schemaVersion:1,stages:kinds.map(kind=>({id:kind,kind,label:kind.replaceAll('_',' '),enabled:true}))});
const requirements={optionsRequired:true,requiredInformationalStageIds:[]};
describe('versioned paid journey foundation',()=>{
 it.each([false,true])('roundtrips default and reordered customer-information journey (%s)',reordered=>{
  const input=defaultJourney();if(reordered)[input.stages[2],input.stages[3]]=[input.stages[3]!,input.stages[2]!];
  const result=validatePaidJourney(JSON.parse(JSON.stringify(input)),requirements);
  expect(result).toEqual(input);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.stages)).toBe(true);expect(result.stages.every(Object.isFrozen)).toBe(true);
  input.stages[0]!.label='Edited afterwards';expect(result.stages[0]!.label).toBe('service');
 });
 it('disables options only against explicit catalog evidence and keeps informational consent required',()=>{
  const input={...defaultJourney(),stages:[...defaultJourney().stages.slice(0,4),{id:'informational_consent',kind:'informational',label:'Consent',enabled:true},...defaultJourney().stages.slice(4)]};
  input.stages[1]!.enabled=false;
  expect(()=>validatePaidJourney(input,requirements)).toThrow();
  const trusted={optionsRequired:false,requiredInformationalStageIds:['informational_consent']};
  expect(validatePaidJourney(input,trusted).stages[1]!.enabled).toBe(false);
  input.stages[4]!.enabled=false;expect(()=>validatePaidJourney(input,trusted)).toThrow();
  expect(validatePaidJourney(input,{...trusted,requiredInformationalStageIds:[]}).stages[4]!.enabled).toBe(false);
  expect(()=>validatePaidJourney(defaultJourney(),trusted)).toThrow();
 });
 it.each(['service','schedule','information','review_payment','confirmation'])('cannot disable or omit mandatory %s',kind=>{
  const input=defaultJourney();input.stages.find(stage=>stage.kind===kind)!.enabled=false;expect(PaidJourney.safeParse(input).success).toBe(false);
  expect(PaidJourney.safeParse({...defaultJourney(),stages:defaultJourney().stages.filter(stage=>stage.kind!==kind)}).success).toBe(false);
 });
 it.each([[0,1],[1,2],[2,4],[3,4],[4,5]])('rejects prerequisite/terminal swaps %j',(a,b)=>{
  const input=defaultJourney();[input.stages[a!],input.stages[b!]]=[input.stages[b!]!,input.stages[a!]!];expect(PaidJourney.safeParse(input).success).toBe(false);
 });
 it.each(['price','amount','paymentMode','tenantId','actorId','provider','hold','confirmationAuthority'])('rejects unknown authority key %s at every level',key=>{
  expect(PaidJourney.safeParse({...defaultJourney(),[key]:1}).success).toBe(false);
  const input=defaultJourney();Object.assign(input.stages[2]!,{[key]:1});expect(PaidJourney.safeParse(input).success).toBe(false);
 });
 it('rejects duplicate identities, mismatched primary kinds, unknown stage and schema versions',()=>{
  const input=defaultJourney();input.stages[2]!.id='information';expect(PaidJourney.safeParse(input).success).toBe(false);
  expect(PaidJourney.safeParse({...defaultJourney(),schemaVersion:2}).success).toBe(false);
  expect(PaidJourney.safeParse({...defaultJourney(),stages:[...defaultJourney().stages,{id:'worker',kind:'worker',label:'Worker',enabled:true}]}).success).toBe(false);
  const extra={id:'informational_notes',kind:'informational',label:'Notes',enabled:true};
  expect(PaidJourney.safeParse({...defaultJourney(),stages:[...defaultJourney().stages.slice(0,4),extra,extra,...defaultJourney().stages.slice(4)]}).success).toBe(false);
 });
 it.each(['__proto__','constructor','prototype','informational_constructor','informational_a'.repeat(8),'Information','informational_\n'])('rejects prototype or malformed IDs where appropriate: %s',id=>{
  const extra={id,kind:'informational',label:'Notes',enabled:true};
  const parsed=PaidJourney.safeParse({...defaultJourney(),stages:[...defaultJourney().stages.slice(0,4),extra,...defaultJourney().stages.slice(4)]});
  // A prefixed ordinary ID is not a prototype property identifier.
  expect(parsed.success).toBe(id==='informational_constructor');
 });
 it.each(['',' ','x'.repeat(81),'Invalid\nlabel','\u0000','\ud800','\udfff'])('rejects empty, oversized and invalidly encoded labels',label=>{
  const input=defaultJourney();input.stages[0]!.label=label;expect(PaidJourney.safeParse(input).success).toBe(false);
 });
 it('preserves valid emoji labels without normalization through JSON',()=>{
  const input=defaultJourney();input.stages[0]!.label=' Service 🧹 ';
  expect(validatePaidJourney(JSON.parse(JSON.stringify(input)),requirements).stages[0]!.label).toBe(' Service 🧹 ');
 });
 it('rejects malformed booleans, missing keys, overlong stage arrays and optional stages outside prerequisites',()=>{
  const input=defaultJourney();Object.assign(input.stages[0]!,{enabled:'true'});expect(PaidJourney.safeParse(input).success).toBe(false);
  expect(PaidJourney.safeParse({stages:defaultJourney().stages}).success).toBe(false);
  const extras=Array.from({length:11},(_,i)=>({id:`informational_${i}`,kind:'informational',label:'Notes',enabled:true}));
  expect(PaidJourney.safeParse({...defaultJourney(),stages:[...defaultJourney().stages.slice(0,4),...extras,...defaultJourney().stages.slice(4)]}).success).toBe(false);
  for(const at of [0,1,5,6]){const stages=[...defaultJourney().stages];stages.splice(at,0,extras[0] as never);expect(PaidJourney.safeParse({schemaVersion:1,stages}).success).toBe(false);}
 });
 it.each([undefined,{}, {optionsRequired:false,requiredInformationalStageIds:[],tenantId:'foreign'}, {optionsRequired:false,requiredInformationalStageIds:['informational_a','informational_a']}])('requires strict trusted dependencies %j',context=>{
  expect(()=>validatePaidJourney(defaultJourney(),context as never)).toThrow();
 });
});
