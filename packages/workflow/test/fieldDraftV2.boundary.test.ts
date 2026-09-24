import {expect,it} from 'vitest';
import {parseFieldDraftSaveV2,parseFieldDraftReceiptV2,parseFieldDraftReadV2,parseTextFieldDraftSave,parseTextFieldDraftReceipt,parseTextFieldDraftRead,FIELD_REGISTRY} from '../src/index';
const fields=[{key:'notes',kind:'text',required:false,minLength:0,maxLength:100}];
const save1={textDraftVersion:1,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:{schemaVersion:1,fields}};
const save2={fieldDraftVersion:2,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:{schemaVersion:2,fields}};
const receipt1={textDraftVersion:1,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:save1.definition,runtimePublishable:false};
const receipt2={fieldDraftVersion:2,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:save2.definition,runtimePublishable:false};
it('keeps save families distinct even when numeric revision tokens match',()=>{
 expect(parseTextFieldDraftSave(save1)).toEqual(save1);expect(parseFieldDraftSaveV2(save2)).toEqual(save2);
 expect(()=>parseTextFieldDraftSave(save2)).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
 expect(()=>parseFieldDraftSaveV2(save1)).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
 expect(()=>parseFieldDraftSaveV2({...save2,definition:save1.definition})).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
 expect(()=>parseTextFieldDraftSave({...save1,definition:save2.definition})).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
});
it('rejects cross-version present and missing receipts without fallback or conversion',()=>{
 expect(parseTextFieldDraftReceipt(receipt1).stale).toBe(false);expect(parseFieldDraftReceiptV2(receipt2).stale).toBe(false);
 expect(()=>parseTextFieldDraftRead({status:'present',receipt:receipt2})).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
 expect(()=>parseFieldDraftReadV2({status:'present',receipt:receipt1})).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
 const missing1={status:'missing',textDraftVersion:1,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false};
 const missing2={status:'missing',fieldDraftVersion:2,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false};
 expect(parseTextFieldDraftRead(missing1)).toEqual(missing1);expect(parseFieldDraftReadV2(missing2)).toEqual(missing2);
 expect(()=>parseTextFieldDraftRead(missing2)).toThrow('INVALID_TEXT_DRAFT_CONTRACT');expect(()=>parseFieldDraftReadV2(missing1)).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
});
it('never changes runtime capability flags or admits publication through a V2 receipt',()=>{
 expect(FIELD_REGISTRY.every(value=>!value.runtimePublishable&&!value.persistenceSupported&&!value.rendererSupported)).toBe(true);
 expect(()=>parseFieldDraftReceiptV2({...receipt2,runtimePublishable:true})).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
});
