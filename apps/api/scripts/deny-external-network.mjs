// Test-only in-process fetch/TCP guard, not an OS sandbox. No child-process coverage.
import assert from 'node:assert/strict';
import net from 'node:net';
const allowed=new Set(['127.0.0.1','localhost','::1']);
const originalFetch=globalThis.fetch;
let denied=0;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed.has(u.hostname)){denied++;throw Error('AUDIT_EXTERNAL_NETWORK_DENIED');}return originalFetch(input,init);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const x=Array.isArray(args[0])?args[0]:args;const opts=x[0];const host=typeof opts==='object'?opts.host:(typeof x[1]==='string'?x[1]:'localhost');if(host&&!allowed.has(host)){denied++;throw Error('AUDIT_EXTERNAL_NETWORK_DENIED');}return connect.apply(this,args);};
await assert.rejects(fetch('https://api.openai.com/v1/models'),/AUDIT_EXTERNAL_NETWORK_DENIED/);
assert.throws(()=>net.connect({host:'api.anthropic.com',port:443}),/AUDIT_EXTERNAL_NETWORK_DENIED/);
console.log('PASS network-denial self-tests; external fetch/TCP blocked; synthetic probes=2');
process.on('exit',()=>{if(denied!==2){console.error('FAIL unexpected external dependency attempts='+ (denied-2));process.exitCode=1;}else console.log('PASS no external dependency attempts during journey');});

