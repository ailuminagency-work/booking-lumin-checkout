import type {IncomingMessage,ServerResponse} from 'node:http';
import {performance} from 'node:perf_hooks';
import {attachRequestId} from './request-id';
import {readReleaseMetadata,type ReleaseEnvironment} from './release-metadata';
type Method='GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS'|'OTHER';
type RouteFamily='health'|'readiness'|'version'|'customer_flow'|'owner_notifications'|'owner_booking'|'owner_business'|'owner_catalog'|'owner_publication'|'owner_roster'|'other';
export type RequestTelemetry=Readonly<{event:'staging_request';schemaVersion:1;service:'booking-lumin-api';environment:'staging';releaseSha:string|null;requestId:string;method:Method;routeFamily:RouteFamily;outcome:'completed'|'aborted';statusCode:number|null;durationMs:number;durationCapped:boolean}>;
const methods:readonly string[]=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
const maximumDuration=300000;
function family(raw:string|undefined):RouteFamily{
 let path:string;try{path=new URL(raw??'','http://localhost').pathname;}catch{return 'other';}
 if(path==='/health')return 'health';if(path==='/ready')return 'readiness';if(path==='/version')return 'version';
 if(path.startsWith('/api/flow-sessions/')||path.startsWith('/api/detailing-flow-sessions/'))return 'customer_flow';
 if(['/api/confirmation-receipts','/api/confirmation-receipt-history','/api/notification-planner-config'].includes(path))return 'owner_notifications';
 if(path.startsWith('/api/bookings/')||path.startsWith('/api/reservations/'))return 'owner_booking';
 if(['/api/businesses','/api/business-profile','/api/business-profile/initialize','/api/profile'].includes(path))return 'owner_business';
 if(path.startsWith('/api/catalog/')||path==='/api/availability')return 'owner_catalog';
 if(path.startsWith('/api/paid-')||path.startsWith('/api/detailing-'))return 'owner_publication';
 if(path==='/api/roster'||path.startsWith('/api/roster/'))return 'owner_roster';
 return 'other';
}
/** Fixed fields only. Completion means the response finished, not customer delivery.
 * No telemetry outside exact staging; logger failure never affects the response. */
export function createRequestTelemetry(env:ReleaseEnvironment,emit:(record:RequestTelemetry)=>void|Promise<void>=record=>{console.log(JSON.stringify(record));},now:()=>number=()=>performance.now()):(req:IncomingMessage,res:ServerResponse)=>void{
 if(env.BOOKING_LUMIN_ENV!=='staging')return()=>{};
 const metadata=readReleaseMetadata(env),observed=new WeakSet<ServerResponse>();
 return(req,res)=>{
  if(observed.has(res))return;observed.add(res);
  const requestId=attachRequestId(req,res),method:Method=methods.includes(req.method??'')?req.method as Method:'OTHER',routeFamily=family(req.url);
  const start=now();let emitted=false;
  const record=(outcome:'completed'|'aborted')=>{
   if(emitted)return;emitted=true;res.removeListener('finish',finished);res.removeListener('close',closed);req.removeListener('aborted',aborted);
   const elapsed=now()-start,finite=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
   const statusCode=outcome==='completed'&&Number.isInteger(res.statusCode)&&res.statusCode>=100&&res.statusCode<=999?res.statusCode:null;
   const value:RequestTelemetry=Object.freeze({event:'staging_request',schemaVersion:1,service:metadata.service,environment:'staging',releaseSha:metadata.releaseSha,requestId,method,routeFamily,outcome,statusCode,durationMs:Math.min(maximumDuration,Math.round(finite)),durationCapped:Number.isFinite(elapsed)&&elapsed>maximumDuration});
   try{void Promise.resolve(emit(value)).catch(()=>{});}catch{}
  };
  const finished=()=>record('completed'),closed=()=>record(res.writableFinished?'completed':'aborted'),aborted=()=>record('aborted');
  res.once('finish',finished);res.once('close',closed);req.once('aborted',aborted);
 };
}
