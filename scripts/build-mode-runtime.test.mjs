import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeIdentity, buildModeRuntime } from './build-mode-runtime.mjs';
const identity={abiVersion:1,profileVersion:'runtime-test-v1',rendererOrigin:'https://renderer.test',apiOrigin:'https://api.test',portalOrigin:'https://portal.test'};
test('identity captures only canonical trusted compile constants',()=>{assert.deepEqual(runtimeIdentity(identity),identity);assert.ok(Object.isFrozen(runtimeIdentity(identity)));});
for(const [name,change] of Object.entries({abi:{abiVersion:2},same:{apiOrigin:identity.rendererOrigin},http:{rendererOrigin:'http://renderer.test'},path:{apiOrigin:'https://api.test/path'},alias:{rendererOrigin:'https://RENDERER.test'},profile:{profileVersion:'Version1'},extra:{loaderUrl:'https://renderer.test/a'},numeric:{rendererOrigin:'https://127.0.0.1'},unicode:{rendererOrigin:'https://xn--bcher-kva.test'}}))test('rejects '+name,()=>assert.throws(()=>runtimeIdentity({...identity,...change})));
test('does not execute accessor identity',()=>{let reads=0;const value={...identity};Object.defineProperty(value,'apiOrigin',{enumerable:true,get(){reads++;return identity.apiOrigin;}});assert.throws(()=>runtimeIdentity(value));assert.equal(reads,0);});
test('rejects an output outside the dedicated cache before building',async()=>{await assert.rejects(buildModeRuntime({identity,outRoot:'../escape'}),/INVALID_RUNTIME_OUTPUT/);});
