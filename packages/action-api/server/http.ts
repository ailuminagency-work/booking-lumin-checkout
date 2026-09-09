import { createServer,type IncomingMessage,type ServerResponse } from "node:http";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { z } from "zod";
import { Uuid,SaveDraft,PublishDraft,RequestInput,RpcResults,type FlowRpc } from "./contracts";
import { FlowError,type FlowCode,type FlowRepository } from "./repository";
const statuses:Record<FlowCode,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,INTERNAL_ERROR:500,RATE_LIMITED:429};
export interface FlowHttpOptions{
 repository:FlowRepository;
 /** Fresh verified user identity only. SQL rechecks current tenant membership. */
 authenticateOwner?:(credential:string)=>Promise<string|null>;
 ownerOrigins:readonly string[];
 customerOrigins:readonly string[];
 now?:()=>number;
}
function bearer(req:IncomingMessage){const h=req.headers.authorization;if(typeof h!=="string"||!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(h))throw new FlowError("UNAUTHENTICATED");return h.slice(7);}
export const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(value));}
function jsonBody(req:IncomingMessage):Promise<unknown>{
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers["content-type"]??""))throw new FlowError("INVALID_REQUEST");
 return new Promise((resolve,reject)=>{let bytes=0;const chunks:Buffer[]=[];let failed=false;
  req.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32768){if(!failed){failed=true;reject(new FlowError("INVALID_REQUEST"));}return;}if(!failed)chunks.push(chunk);});
  req.on("end",()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{reject(new FlowError("INVALID_REQUEST"));}});
  req.on("error",()=>reject(new FlowError("INVALID_REQUEST")));req.on("aborted",()=>reject(new FlowError("INVALID_REQUEST")));
 });
}
function originHeader(req:IncomingMessage,allowed:readonly string[]){const value=req.headers.origin;if(typeof value!=="string"||!allowed.includes(value))throw new FlowError("FORBIDDEN");return value;}
/** Local harness HTTP only. Production needs a separately reviewed TLS/auth composition. */
export function createFlowHttpServer(options:FlowHttpOptions){
 const ownerOrigins=[...options.ownerOrigins],customerOrigins=[...options.customerOrigins];
 const now=options.now??Date.now;const limits=new Map<string,{start:number;count:number}>();
 const server=createServer({maxHeaderSize:16384},async(req,res)=>{
  try{
   const address=req.socket.remoteAddress??"";if(!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(address))throw new FlowError("FORBIDDEN");
   const instant=now();let rate=limits.get(address);if(!rate||instant-rate.start>=60000){rate={start:instant,count:0};limits.set(address,rate);}if(++rate.count>120)throw new FlowError("RATE_LIMITED");
   const url=new URL(req.url??"/","http://127.0.0.1");
   if(url.pathname==="/health"&&req.method==="GET"){send(res,200,{ok:true,data:{mode:"LOCAL_HARNESS",providerConnections:false}});return;}
   const customer=url.pathname.startsWith("/api/installations/")||url.pathname==="/api/flow-sessions/request";
   const origin=originHeader(req,customer?customerOrigins:ownerOrigins);
   res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");
   if(req.method==="OPTIONS"){
    if(!["GET","POST"].includes(req.headers["access-control-request-method"]??""))throw new FlowError("FORBIDDEN");
    const requested=(req.headers["access-control-request-headers"]??"").toLowerCase().split(",").map(x=>x.trim()).filter(Boolean);
    if(requested.some(x=>!["content-type","authorization"].includes(x)))throw new FlowError("FORBIDDEN");
    res.writeHead(204,{"Access-Control-Allow-Methods":"GET, POST","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"60"});res.end();return;
   }
   const owner=async()=>{if(!options.authenticateOwner)throw new FlowError("UNAUTHENTICATED");let id:unknown;try{id=await options.authenticateOwner(bearer(req));}catch{throw new FlowError("UNAUTHENTICATED");}if(!Uuid.safeParse(id).success)throw new FlowError("UNAUTHENTICATED");return id as string;};
   const call=async(name:FlowRpc,params:readonly unknown[])=>{const value=await options.repository.call(name,params);try{return RpcResults[name].parse(value);}catch{throw new FlowError("INTERNAL_ERROR");}};
   if(customer){
    if([...url.searchParams].length||req.method!=="POST")throw new FlowError("INVALID_REQUEST");
    const match=url.pathname.match(/^\/api\/installations\/([^/]+)\/sessions$/);
    if(match){const id=Uuid.parse(match[1]);z.object({}).strict().parse(await jsonBody(req));
     const sessionToken=randomBytes(32).toString("base64url");const data=await call("issue_flow_session",[id,tokenHash(sessionToken),origin]);send(res,200,{ok:true,data:{...data,sessionToken}});return;
    }
    if(url.pathname==="/api/flow-sessions/request"){
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError("UNAUTHENTICATED");
     const body=RequestInput.parse(await jsonBody(req));const data=await call("submit_flow_request",[tokenHash(token),origin,body.idempotencyKey,body.answers,body.customer,body.requestedStart]);send(res,200,{ok:true,data});return;
    }throw new FlowError("NOT_AVAILABLE");
   }
   const actor=await owner();
   if([...url.searchParams.keys()].some(k=>k!=="tenantId")||url.searchParams.getAll("tenantId").length!==1)throw new FlowError("INVALID_REQUEST");
   const tenant=Uuid.parse(url.searchParams.get("tenantId"));
   const lists:Record<string,FlowRpc>={"/api/services":"flow_owner_services","/api/flows":"flow_owner_list","/api/requests":"flow_owner_requests"};
   if(req.method==="GET"&&Object.hasOwn(lists,url.pathname)){send(res,200,{ok:true,data:await call(lists[url.pathname]!,[actor,tenant])});return;}
   const match=url.pathname.match(/^\/api\/flows\/([^/]+)\/(draft|publish)$/);if(!match)throw new FlowError("NOT_AVAILABLE");const flow=Uuid.parse(match[1]);
   if(match[2]==="draft"&&req.method==="GET"){send(res,200,{ok:true,data:await call("flow_owner_draft",[actor,tenant,flow])});return;}
   if(match[2]==="draft"&&req.method==="POST"){
    const raw=await jsonBody(req);const body=SaveDraft.safeParse(raw);if(!body.success)throw new FlowError("INVALID_REQUEST");
    const b=body.data;send(res,200,{ok:true,data:await call("save_bound_flow_draft",[actor,tenant,flow,b.serviceId,b.expectedRevision,b.name,b.config])});return;
   }
   if(match[2]==="publish"&&req.method==="POST"){
    const body=PublishDraft.parse(await jsonBody(req));if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_bound_flow.parse(await call("publish_bound_flow",[actor,tenant,flow,body.expectedRevision,randomUUID(),randomUUID(),body.allowedOrigins]));
    send(res,200,{ok:true,data:{...data,hostedPath:`/checkout/flow/${data.installationId}`}});return;
   }throw new FlowError("NOT_AVAILABLE");
  }catch(error){const code=error instanceof FlowError&&Object.hasOwn(statuses,error.code)?error.code:error instanceof z.ZodError?"INVALID_REQUEST":"INTERNAL_ERROR";if(!res.headersSent)send(res,statuses[code],{ok:false,code});else res.end();}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return server;
}
