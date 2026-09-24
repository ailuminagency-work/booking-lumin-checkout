import {expect,it,vi} from 'vitest';
import {snapshotFieldPublicationV1 as snapshot} from '../src/fieldPublicationSnapshotV1';
import {parseFieldDraftReceiptV3} from '../src/fieldDraftV3';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',flow='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input=()=>({tenantId:tenant,flowId:flow,versionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expectedParentRevision:3,expectedFieldDraftRevision:2,source:{tenantId:tenant,flowId:flow,receipt:{fieldDraftVersion:3,parentAuthoringVersion:2,draftRevision:2,savedParentRevision:3,currentParentRevision:3,runtimePublishable:false,definition:{schemaVersion:3,fields:[{key:'choice',kind:'dropdown',required:false,choices:[{id:'First',label:' Same '},{id:'second',label:' Same '}] }]}}}});
const reject=(value:unknown)=>expect(()=>snapshot(value)).toThrow(/^INVALID_FIELD_PUBLICATION_SNAPSHOT_V1_CONTRACT$/);

it('rejects cross-tenant and cross-flow sources including case-only spelling changes',()=>{
 for(const key of ['tenantId','flowId'] as const){const value=input();reject({...value,source:{...value.source,[key]:value.source[key].toUpperCase()}});reject({...value,[key]:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});}
 const upper=input();upper.tenantId=upper.source.tenantId=tenant.toUpperCase();expect(snapshot(upper).tenantId).toBe(tenant.toUpperCase());
});

it('refuses mismatched source revisions or stale receipts without rebasing',()=>{
 for(const expectedParentRevision of [2,4])reject({...input(),expectedParentRevision});for(const expectedFieldDraftRevision of [1,3])reject({...input(),expectedFieldDraftRevision});
 for(const changes of [{savedParentRevision:2},{currentParentRevision:4},{savedParentRevision:4},{draftRevision:3}]){const value=input();reject({...value,source:{...value.source,receipt:{...value.source.receipt,...changes}}});}
 const maximum=input();maximum.expectedParentRevision=maximum.source.receipt.savedParentRevision=maximum.source.receipt.currentParentRevision=Number.MAX_SAFE_INTEGER;maximum.expectedFieldDraftRevision=maximum.source.receipt.draftRevision=Number.MAX_SAFE_INTEGER;expect(snapshot(maximum).sourceFieldDraftRevision).toBe(Number.MAX_SAFE_INTEGER);
});

it('rejects unsafe expected revisions and identity coercion before constructing a snapshot',()=>{
 for(const key of ['expectedParentRevision','expectedFieldDraftRevision'])for(const value of [0,-0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'3',null,true])reject({...input(),[key]:value});
 const coercion=vi.fn(()=>tenant);for(const key of ['tenantId','flowId','versionId'])for(const value of ['',tenant+' ',tenant+'\n',null,3,{toString:coercion}])reject({...input(),[key]:value});expect(coercion).not.toHaveBeenCalled();
});

it('rejects parsed receipts, cross-version wire data and invented authority fields',()=>{
 const value=input();reject({...value,source:{...value.source,receipt:parseFieldDraftReceiptV3(value.source.receipt)}});
 for(const changes of [{stale:false},{stale:true},{runtimePublishable:true},{fieldDraftVersion:2},{parentAuthoringVersion:3}])reject({...value,source:{...value.source,receipt:{...value.source.receipt,...changes}}});
 for(const key of ['authorized','actorId','submissionMode','answers','price','expectedRevision']){reject({...value,[key]:true});reject({...value,source:{...value.source,[key]:true}});}
});

it('requires exact complete own enumerable records at both binding levels',()=>{
 for(const key of Object.keys(input())){const value:Record<string,unknown>={...input()};delete value[key];reject(value);}
 for(const key of Object.keys(input().source)){const value=input(),source:Record<string,unknown>={...value.source};delete source[key];reject({...value,source});}
 for(const level of ['outer','source']){
  const value=input(),record=level==='outer'?value:value.source;
  const replace=(record:unknown)=>level==='outer'?record:{...value,source:record};
  reject(replace(Object.assign(Object.create({authority:true}),record)));reject(replace({...record,[Symbol('secret')]:true}));reject(replace(Object.defineProperty({...record},'tenantId',{enumerable:false})));
 }
});

it('does not invoke accessors and reports only finite errors for throwing proxies and cycles',()=>{
 const getter=vi.fn(()=>{throw Error('private token');});
 for(const key of Object.keys(input()))reject(Object.defineProperty(input(),key,{get:getter,enumerable:true}));
 for(const key of Object.keys(input().source)){const value=input();reject({...value,source:Object.defineProperty(value.source,key,{get:getter,enumerable:true})});}
 const nested=input();Object.defineProperty(nested.source.receipt,'definition',{get:getter,enumerable:true});reject(nested);expect(getter).not.toHaveBeenCalled();
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor'])reject(new Proxy(input(),{[trap](){throw Error('private token');}}));
 const cycle:Record<string,unknown>={...input()};cycle.source=cycle;reject(cycle);
});

it('captures changing outer, source and raw receipt descriptors once so comparisons bind returned content',()=>{
 const value=input(),counts=new Map<string,number>();
 function changing<T extends object>(object:T,level:string):T{return new Proxy(object,{getOwnPropertyDescriptor(target,key){const label=level+String(key),count=(counts.get(label)??0)+1;counts.set(label,count);const descriptor=Reflect.getOwnPropertyDescriptor(target,key);return descriptor&&count>1?{...descriptor,value:'substituted'}:descriptor;}});}
 const receipt=changing(value.source.receipt,'receipt.'),source=changing({...value.source,receipt},'source.'),outer=changing({...value,source},'outer.');
 const output=snapshot(outer);expect(output.tenantId).toBe(tenant);expect(output.flowId).toBe(flow);expect(output.sourceParentRevision).toBe(3);expect(output.sourceFieldDraftRevision).toBe(2);expect(output.definition).toEqual(value.source.receipt.definition);
 for(const count of counts.values())expect(count).toBe(1);
});

it('detaches and freezes all publication data without leaking source wrapper or expectation fields',()=>{
 const value=input(),output=snapshot(value);value.source.tenantId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';value.source.receipt.definition.fields[0]!.choices[0]!.label='changed';value.source.receipt.definition.fields[0]!.choices.reverse();
 expect(output).toEqual({fieldPublicationVersion:1,tenantId:tenant,flowId:flow,versionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',parentAuthoringVersion:2,sourceParentRevision:3,sourceFieldDraftRevision:2,definition:{schemaVersion:3,fields:[{key:'choice',kind:'dropdown',required:false,choices:[{id:'First',label:' Same '},{id:'second',label:' Same '}]}]},submissionMode:'unconfirmed_request'});
 function frozen(object:unknown):void{if(object&&typeof object==='object'){expect(Object.isFrozen(object)).toBe(true);for(const child of Object.values(object))frozen(child);}}frozen(output);expect(output.definition).not.toBe(value.source.receipt.definition);
});
