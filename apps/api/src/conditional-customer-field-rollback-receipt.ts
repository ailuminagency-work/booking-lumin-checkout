import type {Pool} from 'pg';
import type {z} from 'zod';
import {ConditionalCustomerFieldRollbackReceipt} from './conditional-customer-field-rollback';
import {createConditionalCustomerFieldVersionHistoryReader} from './conditional-customer-field-version-history';
import {FlowError} from './repository';

export const ConditionalCustomerFieldRollbackReadReceipt=ConditionalCustomerFieldRollbackReceipt;
export type ConditionalCustomerFieldRollbackReadReceipt=z.infer<typeof ConditionalCustomerFieldRollbackReadReceipt>;
export type ConditionalCustomerFieldRollbackReceiptReader=(actor:string,tenant:string,flow:string)=>Promise<ConditionalCustomerFieldRollbackReadReceipt>;

/** One bounded owner snapshot read only. The current pointer is evidence of
 * committed state, never proof of which attempt changed it or retry authority. */
export function createConditionalCustomerFieldRollbackReceiptReader(pool:Pool,approvedOrigins:readonly string[]):ConditionalCustomerFieldRollbackReceiptReader{
 const history=createConditionalCustomerFieldVersionHistoryReader(pool,approvedOrigins);
 return async(actor,tenant,flow)=>{
  const result=await history(actor,tenant,flow),current=result.versions.find(version=>version.current);
  if(!current?.publication)throw new FlowError('NOT_AVAILABLE');
  const receipt=ConditionalCustomerFieldRollbackReadReceipt.safeParse({flowId:result.flowId,...current.publication});
  if(!receipt.success||receipt.data.flowId!==flow||receipt.data.versionId!==current.versionId||receipt.data.renderSchemaVersion!==current.renderSchemaVersion)throw new FlowError('NOT_AVAILABLE');
  return receipt.data;
 };
}
