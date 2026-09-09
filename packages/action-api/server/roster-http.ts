import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {z} from 'zod';
import {RosterWorkerInput,RosterCrewInput,RosterMemberInput,RosterEligibilityInput,RosterShiftInput,RosterVersion} from '@lumin/contracts';
import {Uuid,postgresV2Strings,type FlowRpc} from './contracts';
import {FlowError} from './repository';
export async function handleRosterRoute(req:IncomingMessage,path:string,actor:string,tenant:string,call:(name:FlowRpc,params:readonly unknown[])=>Promise<unknown>,read:()=>Promise<unknown>){
 if(path==='/api/roster'&&req.method==='GET'){
  if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0)throw new FlowError('INVALID_REQUEST');
  return call('owner_roster_snapshot',[actor,tenant]);
 }
 if(req.method!=='POST')throw new FlowError('NOT_AVAILABLE');
 const raw=await read();if(!postgresV2Strings(raw))throw new FlowError('INVALID_REQUEST');
 if(path==='/api/roster/provision'){z.object({}).strict().parse(raw);return {rosterVersion:RosterVersion.parse(await call('roster_provision',[actor,tenant]))};}
 const member=/^\/api\/roster\/crews\/([^/]+)\/members$/.exec(path);
 if(member){const crewId=Uuid.parse(member[1]),b=RosterMemberInput.parse(raw);const rosterVersion=RosterVersion.parse(await call('roster_crew_member_set',[actor,tenant,b.expectedRosterVersion,crewId,b.workerId,b.present]));return {rosterVersion,crewId,workerId:b.workerId,present:b.present};}
 if(path==='/api/roster/eligibility'){const b=RosterEligibilityInput.parse(raw);const rosterVersion=RosterVersion.parse(await call('roster_eligibility_put',[actor,tenant,b.expectedRosterVersion,b.serviceId,b.workerId,b.active,b.create]));return {rosterVersion,serviceId:b.serviceId,workerId:b.workerId,active:b.active};}
 const entity=/^\/api\/roster\/(workers|crews|shifts)(?:\/([^/]+))?$/.exec(path);if(!entity)throw new FlowError('NOT_AVAILABLE');
 const create=entity[2]===undefined,id=create?randomUUID():Uuid.parse(entity[2]);let version:unknown;
 if(entity[1]==='workers'){const b=RosterWorkerInput.parse(raw);version=await call('roster_worker_put',[actor,tenant,b.expectedRosterVersion,id,b.displayName,b.active,create]);}
 else if(entity[1]==='crews'){const b=RosterCrewInput.parse(raw);version=await call('roster_crew_put',[actor,tenant,b.expectedRosterVersion,id,b.name,b.active,create]);}
 else{const b=RosterShiftInput.parse(raw);version=await call('roster_shift_put',[actor,tenant,b.expectedRosterVersion,id,b.workerId,b.kind,b.startsAt,b.endsAt,b.sourceTimeZone,b.active,create]);}
 return {rosterVersion:RosterVersion.parse(version),entityId:id};
}
