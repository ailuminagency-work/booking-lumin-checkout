import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

// These invocations fail before transport, so ordinary CI never mutates staging.
for(const [name,optIn,args,message] of [
 ['requires explicit staging mutation opt-in','',[],/Explicit isolated staging test opt-in required/],
 ['requires explicit valid fixture identities and release','1',['not-a-fixture'],/Explicit fixture identities and release SHA required/]
])test(name,()=>{
 const result=spawnSync(process.execPath,['--import','tsx','scripts/detailing-hosted-customer.mjs',...args],{encoding:'utf8',env:{...process.env,DETAILING_HOSTED_TEST:optIn},timeout:15000});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,message);assert.equal(result.stdout,'');
});
