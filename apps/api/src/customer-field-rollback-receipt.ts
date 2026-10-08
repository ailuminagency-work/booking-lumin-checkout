import type {Pool} from 'pg';
import type {z} from 'zod';
import {CustomerFieldRollbackReceipt} from './customer-field-rollback';
import {createCustomerFieldVersionHistoryReader} from './customer-field-version-history';
import {FlowError} from './repository';

export const CustomerFieldRollbackReadReceipt=CustomerFieldRollbackReceipt;
export type CustomerFieldRollbackReadReceipt=z.infer<typeof CustomerFieldRollbackReadReceipt>;
export type CustomerFieldRollbackReceiptReader=(actor:string,tenant:string,flow:string)=>Promise<CustomerFieldRollbackReadReceipt>;

/** One bounded owner snapshot read only. The current pointer is evidence of
 * committed state, never proof of which attempt changed it or retry authority. */
export function createCustomerFieldRollbackReceiptReader(pool:Pool,approvedOrigins:readonly string[]):CustomerFieldRollbackReceiptReader{
 const history=createCustomerFieldVersionHistoryReader(pool,approvedOrigins);
 return async(actor,tenant,flow)=>{
  const result=await history(actor,tenant,flow),current=result.versions.find(version=>version.current);
  if(!current?.publication)throw new FlowError('NOT_AVAILABLE');
  const receipt=CustomerFieldRollbackReadReceipt.safeParse({flowId:result.flowId,...current.publication});
  if(!receipt.success||receipt.data.flowId!==flow||receipt.data.versionId!==current.versionId||receipt.data.renderSchemaVersion!==current.renderSchemaVersion)throw new FlowError('NOT_AVAILABLE');
  return receipt.data;
 };
}
