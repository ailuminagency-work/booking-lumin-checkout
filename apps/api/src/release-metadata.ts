import type {IncomingMessage,ServerResponse} from 'node:http';

export interface ReleaseEnvironment {
 BOOKING_LUMIN_ENV?:string;
 RENDER_GIT_COMMIT?:string;
 BOOKING_LUMIN_MIGRATION_HEAD?:string;
}
export interface ReleaseMetadata {
 schemaVersion:1;
 service:'booking-lumin-api';
 environment:'staging'|'demo'|'production'|'unknown';
 releaseSha:string|null;
 migrationHead:string|null;
}

/** Fixed public fields only. Invalid optional configuration never reaches the response. */
export function readReleaseMetadata(env:ReleaseEnvironment):Readonly<ReleaseMetadata>{
 const environment=env.BOOKING_LUMIN_ENV;
 const sha=env.RENDER_GIT_COMMIT;
 const migrationHead=env.BOOKING_LUMIN_MIGRATION_HEAD;
 return Object.freeze({schemaVersion:1,service:'booking-lumin-api',
  environment:environment==='staging'||environment==='demo'||environment==='production'?environment:'unknown',
  releaseSha:typeof sha==='string'&&/^[0-9a-f]{40}$/.test(sha)?sha:null,
  migrationHead:typeof migrationHead==='string'&&/^[0-9]{4}_[a-z0-9_]+$/.test(migrationHead)?migrationHead:null});
}

/** Public GET only, without authentication, database access or CORS changes. */
export function serveReleaseMetadata(req:IncomingMessage,res:ServerResponse,path:string,metadata:Readonly<ReleaseMetadata>):boolean{
 if(req.method!=='GET'||path!=='/version')return false;
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(metadata));
 return true;
}

