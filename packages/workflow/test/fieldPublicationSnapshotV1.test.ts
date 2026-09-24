import { expect,it,vi } from 'vitest';
import { snapshotFieldPublicationV1 as snapshot } from '../src/fieldPublicationSnapshotV1';
import { parseFieldDraftReceiptV3 } from '../src/fieldDraftV3';
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',flowId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',versionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input=()=>({tenantId,flowId,versionId,expectedParentRevision:7,expectedFieldDraftRevision:3,source:{tenantId,flowId,receipt:{fieldDraftVersion:3,parentAuthoringVersion:2,draftRevision:3,savedParentRevision:7,currentParentRevision:7,runtimePublishable:false,definition:{schemaVersion:3,fields:[{key:'choice',kind:'dropdown',required:true,prompt:'  Exact question  ',choices:[{id:'b',label:' Same '},{id:'a',label:' Same '}]}]}}}});
const rejects=(value:unknown)=>expect(()=>snapshot(value)).toThrow(/^INVALID_FIELD_PUBLICATION_SNAPSHOT_V1_CONTRACT$/);
it('projects a bound raw V3 receipt into only the unconfirmed publication envelope',()=>{
 const value=input(),result=snapshot(value);
 expect(result).toEqual({fieldPublicationVersion:1,tenantId,flowId,versionId,parentAuthoringVersion:2,sourceParentRevision:7,sourceFieldDraftRevision:3,definition:value.source.receipt.definition,submissionMode:'unconfirmed_request'});
 expect('runtimePublishable' in result).toBe(false);expect('stale' in result).toBe(false);expect('source' in result).toBe(false);
});
it('requires exact tenant and flow binding without UUID normalization',()=>{
 for(const key of ['tenantId','flowId'] as const){const value=input();value.source[key]=versionId;rejects(value);const upper=input();upper.source[key]=upper.source[key].toUpperCase();rejects(upper);}
 const value=input();value.tenantId=value.source.tenantId=tenantId.toUpperCase();expect(snapshot(value).tenantId).toBe(tenantId.toUpperCase());
 for(const key of ['tenantId','flowId','versionId'] as const){const value=input();value[key]='bad';if(key!=='versionId')value.source[key]='bad';rejects(value);}
});
it('rejects stale receipts and either mismatched expected token without rebasing',()=>{
 for(const key of ['expectedParentRevision','expectedFieldDraftRevision'] as const){const value=input();value[key]++;rejects(value);}
 const stale=input();stale.source.receipt.currentParentRevision=8;rejects(stale);stale.expectedParentRevision=8;rejects(stale);
 const reversed=input();reversed.source.receipt.savedParentRevision=8;rejects(reversed);
});
it.each([0,-0,-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1,'3',null,undefined])('rejects invalid expected revision %s',value=>{
 for(const key of ['expectedParentRevision','expectedFieldDraftRevision'])rejects({...input(),[key]:value});
});
it('accepts safe maximum exact tokens without claiming an increment',()=>{
 const value=input();value.expectedParentRevision=value.source.receipt.savedParentRevision=value.source.receipt.currentParentRevision=Number.MAX_SAFE_INTEGER;
 value.expectedFieldDraftRevision=value.source.receipt.draftRevision=Number.MAX_SAFE_INTEGER;expect(snapshot(value).sourceFieldDraftRevision).toBe(Number.MAX_SAFE_INTEGER);
});
it('requires raw wire receipt and rejects derived stale or activation metadata',()=>{
 const value=input();rejects({...value,source:{...value.source,receipt:parseFieldDraftReceiptV3(value.source.receipt)}});
 for(const extra of [{enabled:true},{runtimePublishable:true},{submissionMode:'confirmed_booking'}])rejects({...input(),...extra});
 for(const extra of [{stale:false},{runtimePublishable:true},{fieldDraftVersion:2},{parentAuthoringVersion:1}]){const value=input();rejects({...value,source:{...value.source,receipt:{...value.source.receipt,...extra}}});}
});
it('detaches and deeply freezes the supplied document and ordered choice identities',()=>{
 const value=input(),result=snapshot(value);
 function frozen(value:unknown):void{if(value&&typeof value==='object'){expect(Object.isFrozen(value)).toBe(true);for(const child of Object.values(value))frozen(child);}}frozen(result);
 value.source.receipt.definition.fields[0]!.choices.reverse();value.source.receipt.definition.fields[0]!.choices[0]!.label='Changed';
 expect(result.definition.fields[0]).toMatchObject({choices:[{id:'b',label:' Same '},{id:'a',label:' Same '}]});
 expect(result.definition).not.toBe(value.source.receipt.definition);
});
it('rejects missing, extra, inherited and accessor wrapper properties without invoking getters',()=>{
 for(const key of Object.keys(input())){const value:Record<string,unknown>={...input()};delete value[key];rejects(value);}
 for(const key of Object.keys(input().source)){const value=input(),source:Record<string,unknown>={...value.source};delete source[key];rejects({...value,source});}
 const getter=vi.fn(()=>input().source);const value=input();Object.defineProperty(value,'source',{get:getter,enumerable:true});rejects(value);expect(getter).not.toHaveBeenCalled();
 const nested=input();Object.defineProperty(nested.source,'receipt',{get:getter,enumerable:true});rejects(nested);expect(getter).not.toHaveBeenCalled();
 rejects(Object.create(input()));rejects({...input(),source:{...input().source,extra:true}});rejects({...input(),[Symbol('extra')]:true});
 expect(snapshot(Object.assign(Object.create(null),input()))).toEqual(snapshot(input()));
});
