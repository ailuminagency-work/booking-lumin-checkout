import { expect, it } from 'vitest';
import { FIELD_REGISTRY, parseTextFieldDocument, parseTextAnswers, parseTextFieldDraftSave, parseTextFieldDraftReceipt, parseFieldDocumentV2, parseFieldAnswersV2 } from '../src/index';

const field = {key:'instructions',kind:'textarea',required:false,minLength:0,maxLength:200};
const v2 = {schemaVersion:2,fields:[field]};
it('exposes the explicit V2 contract without changing the existing capability registry',()=>{
 expect(parseFieldDocumentV2(v2)).toEqual(v2);
 expect(parseFieldAnswersV2(v2,{schemaVersion:2,answers:[{key:'instructions',value:'First\r\nSecond'}]}).answers[0]?.value).toBe('First\r\nSecond');
 expect(FIELD_REGISTRY.filter(item=>item.contractSupported).map(item=>item.kind)).toEqual(['text']);
 expect(FIELD_REGISTRY.every(item=>!item.runtimePublishable&&!item.rendererSupported&&!item.persistenceSupported)).toBe(true);
});
it('cannot pass V2 definitions through existing text draft save or receipt contracts',()=>{
 expect(()=>parseTextFieldDraftSave({textDraftVersion:1,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:v2})).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
 expect(()=>parseTextFieldDraftReceipt({textDraftVersion:1,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:v2,runtimePublishable:false})).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
 expect(()=>parseTextFieldDocument(v2)).toThrow('INVALID_TEXT_CONTRACT');
});
it('preserves V1 behavior while rejecting both directions of version confusion',()=>{
 const v1={schemaVersion:1,fields:[{...field,kind:'text'}]};
 const answer={key:'instructions',value:'legacy\u0000value'};
 expect(parseTextAnswers(v1,{schemaVersion:1,answers:[answer]}).answers[0]).toEqual(answer);
 expect(()=>parseFieldDocumentV2(v1)).toThrow('INVALID_FIELD_V2_CONTRACT');
 expect(()=>parseFieldAnswersV2(v2,{schemaVersion:1,answers:[]})).toThrow('INVALID_FIELD_V2_CONTRACT');
 expect(()=>parseTextAnswers(v1,{schemaVersion:2,answers:[]})).toThrow('INVALID_TEXT_CONTRACT');
});
