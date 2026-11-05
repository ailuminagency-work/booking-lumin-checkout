import {describe,it,expect} from 'vitest';
import {PaidJourneyPublicationSnapshot,PaidJourneyRender,parsePaidJourneyRender,validatePaidJourneySnapshotAgainstServerCatalog} from '../src/paidJourneyPublication';
import {PaidSimpleRender} from '../src/paidPublication';
import {PaidOptionRender} from '../src/paidOptionPublication';
import {PaidCustomerFieldRender} from '../src/paidCustomerFieldPublication';
import {PaidConditionalCustomerFieldRender} from '../src/paidConditionalCustomerFieldPublication';
import {DetailingCatalogRender} from '../src/detailingPublication';

const versionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const service={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Housekeeping visit',durationMinutes:60,price:{amount:12500,currency:'USD'}};
const snapshot=()=>({renderSchemaVersion:8,submissionMode:'paid_journey_request',paymentMode:'staging_mock',simulated:true,service:structuredClone(service),form:{name:'Housekeeping staging 🧹',presentation:{accentColor:'#0e7490',layout:'compact'},journey:{schemaVersion:1,stages:['service','options','schedule','information','review_payment','confirmation'].map(kind=>({id:kind,kind,label:kind,enabled:true}))}}});
const render=()=>({...snapshot(),versionId});
describe('dedicated immutable V8 journey publication boundary',()=>{
 it('matches the exact SQL storage shape and adds only version identity in the dedicated render',()=>{
  const stored=PaidJourneyPublicationSnapshot.parse(snapshot()),published=parsePaidJourneyRender(render());expect(stored).toEqual(snapshot());expect(published).toEqual(render());expect(PaidJourneyPublicationSnapshot.safeParse(render()).success).toBe(false);expect(PaidJourneyRender.safeParse(snapshot()).success).toBe(false);
  expect(Object.isFrozen(stored)).toBe(true);expect(Object.isFrozen(stored.form.journey.stages[0])).toBe(true);expect(Object.isFrozen(published.service.price)).toBe(true);expect(Object.isFrozen(published.form.presentation)).toBe(true);
 });
 it('clones all nested input before freezing and accepts optional options and information-before-schedule ordering',()=>{
  const input=render();input.form.journey.stages[1]!.enabled=false;[input.form.journey.stages[2],input.form.journey.stages[3]]=[input.form.journey.stages[3]!,input.form.journey.stages[2]!];const result=parsePaidJourneyRender(input);input.service.price.amount=1;input.form.journey.stages[0]!.label='Changed';expect(result.service.price.amount).toBe(12500);expect(result.form.journey.stages[0]!.label).toBe('service');expect(result.form.journey.stages[1]!.enabled).toBe(false);
 });
 it.each(['tenantId','actorId','flowId','draftRevision','publication','trustedRequirements','customerAnswers','amount','provider'])('rejects private or authority field %s at every publication level',key=>{
  for(const location of ['root','form','journey','service','price','presentation','stage']){const value=render(),target=location==='root'?value:location==='form'?value.form:location==='journey'?value.form.journey:location==='service'?value.service:location==='price'?value.service.price:location==='presentation'?value.form.presentation:value.form.journey.stages[0]!;Object.assign(target,{[key]:'private-fixture'});expect(PaidJourneyRender.safeParse(value).success).toBe(false);}
 });
 it.each([1,2,3,4,5,6,7,9])('rejects render version %s without widening any existing renderer',renderSchemaVersion=>{expect(PaidJourneyRender.safeParse({...render(),renderSchemaVersion}).success).toBe(false);});
 it('leaves all legacy paid and detailing contracts rejecting V8',()=>{for(const schema of [PaidSimpleRender,PaidOptionRender,PaidCustomerFieldRender,PaidConditionalCustomerFieldRender,DetailingCatalogRender])expect(schema.safeParse(render()).success).toBe(false);});
 it.each(['service','schedule','information','review_payment','confirmation'])('rejects missing or disabled mandatory %s',kind=>{const value=render();value.form.journey.stages.find(stage=>stage.kind===kind)!.enabled=false;expect(PaidJourneyRender.safeParse(value).success).toBe(false);value.form.journey.stages=value.form.journey.stages.filter(stage=>stage.kind!==kind);expect(PaidJourneyRender.safeParse(value).success).toBe(false);});
 it('rejects duplicate, terminal-reordered, optional unbound information and malicious stage identity',()=>{
  for(const kind of ['duplicate','terminal','extra','prototype']){const value=render();if(kind==='duplicate')value.form.journey.stages[2]!.id='information';else if(kind==='terminal')[value.form.journey.stages[0],value.form.journey.stages[5]]=[value.form.journey.stages[5]!,value.form.journey.stages[0]!];else value.form.journey.stages.splice(4,0,{id:kind==='prototype'?'__proto__':'informational_notes',kind:'informational',label:'Notes',enabled:true});expect(PaidJourneyRender.safeParse(value).success).toBe(false);}
 });
 it.each(['',' ','x'.repeat(201),'invalid\nname','\u0000','\ud800','\udfff'])('rejects unsafe or oversized names %j',name=>{const value=render();value.form.name=name;expect(PaidJourneyRender.safeParse(value).success).toBe(false);value.form.name='Valid';value.service.name=name;expect(PaidJourneyRender.safeParse(value).success).toBe(false);});
 it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN])('rejects invalid pinned financial amount %s',amount=>{const value=render();value.service.price.amount=amount;expect(PaidJourneyRender.safeParse(value).success).toBe(false);});
 it('requires a separate explicit trusted server catalog to prove valid-shaped price or currency tampering',()=>{
  expect(validatePaidJourneySnapshotAgainstServerCatalog(snapshot(),service)).toEqual(snapshot());expect(()=>validatePaidJourneySnapshotAgainstServerCatalog(snapshot(),undefined)).toThrow();const value=snapshot();value.service.price.amount=100;expect(PaidJourneyPublicationSnapshot.safeParse(value).success).toBe(true);expect(()=>validatePaidJourneySnapshotAgainstServerCatalog(value,service)).toThrow();value.service.price.amount=12500;value.service.price.currency='EUR';expect(()=>validatePaidJourneySnapshotAgainstServerCatalog(value,service)).toThrow();expect(()=>validatePaidJourneySnapshotAgainstServerCatalog(snapshot(),{...service,tenantId:'foreign'})).toThrow();
 });
 it.each(['payment','simulation','version','service','design','journey'])('rejects malformed %s identity or capability',kind=>{const value=render();if(kind==='payment')value.paymentMode='stripe';else if(kind==='simulation')value.simulated=false;else if(kind==='version')value.versionId=versionId.toUpperCase();else if(kind==='service')value.service.id='not-uuid';else if(kind==='design')value.form.presentation.layout='grid';else value.form.journey.schemaVersion=2;expect(PaidJourneyRender.safeParse(value).success).toBe(false);});
});
