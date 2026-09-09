import type { Pool } from "pg";
import { RpcResults,type FlowRpc } from "./contracts";
export type FlowCode="INVALID_REQUEST"|"UNAUTHENTICATED"|"FORBIDDEN"|"CONFLICT"|"NOT_AVAILABLE"|"UNSUPPORTED_CONFIG"|"INTERNAL_ERROR"|"RATE_LIMITED";
export class FlowError extends Error{constructor(readonly code:FlowCode){super(code);}}
export interface FlowRepository{call(name:FlowRpc,params:readonly unknown[]):Promise<unknown>}
const signatures:Record<FlowRpc,string[]>={flow_owner_configurable_list:["uuid","uuid"],get_configurable_flow_draft:["uuid","uuid","uuid"],save_configurable_flow_draft:["uuid","uuid","uuid","uuid","bigint","text","jsonb"],publish_configurable_flow:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],flow_owner_services:["uuid","uuid"],flow_owner_list:["uuid","uuid"],flow_owner_draft:["uuid","uuid","uuid"],flow_owner_requests:["uuid","uuid"],save_bound_flow_draft:["uuid","uuid","uuid","uuid","bigint","text","jsonb"],publish_bound_flow:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],issue_flow_session:["uuid","text","text"],submit_flow_request:["text","text","text","jsonb","jsonb","timestamptz"]};
function mapped(error:unknown):FlowError{
 const code=(error as {code?:unknown})?.code;
 return new FlowError(code==="42501"?"FORBIDDEN":code==="40001"||code==="23505"?"CONFLICT":code==="22023"||code==="23514"?"INVALID_REQUEST":code==="P0002"?"NOT_AVAILABLE":code==="0A000"?"UNSUPPORTED_CONFIG":"INTERNAL_ERROR");
}
/** Fixed parameterized RPC adapter; no caller-selected SQL or table access. */
export function createFlowRepository(pool:Pool):FlowRepository{return {async call(name,params){
 const types=signatures[name];if(!types||types.length!==params.length)throw new FlowError("INVALID_REQUEST");
 const client=await pool.connect();
 try{
  await client.query("begin");await client.query("set local role service_role");
  const placeholders=types.map((type,i)=>`$${i+1}::${type}`).join(",");
  const values=params.map((v,i)=>types[i]==="jsonb"?JSON.stringify(v):v);
  const result=await client.query(`select public.${name}(${placeholders}) as result`,values);
  const safe=RpcResults[name].parse(result.rows[0]?.result);
  // Bind fixed RPC receipts to this request before committing side effects.
  if(name==="save_configurable_flow_draft"){
   const receipt=RpcResults.save_configurable_flow_draft.parse(safe);
   if(receipt.flowId!==params[2]||receipt.revision!==Number(params[4])+1)throw new FlowError("INTERNAL_ERROR");
  }else if(name==="get_configurable_flow_draft"){
   if(RpcResults.get_configurable_flow_draft.parse(safe).flowId!==params[2])throw new FlowError("INTERNAL_ERROR");
  }else if(name==="publish_configurable_flow"){
   const receipt=RpcResults.publish_configurable_flow.parse(safe);
   if(receipt.versionId!==params[4]||receipt.installationId!==params[5])throw new FlowError("INTERNAL_ERROR");
  }
  await client.query("commit");return safe;
 }catch(error){await client.query("rollback").catch(()=>{});throw mapped(error);}finally{client.release();}
}};}
