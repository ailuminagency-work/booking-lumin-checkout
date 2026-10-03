import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readinessFailure} from './readiness-error';
test('readiness logs only fixed categories, never error messages or arbitrary codes',()=>{
  assert.equal(readinessFailure({code:'28P01',message:'private connection credential'}),'DB_AUTH');
  assert.equal(readinessFailure({code:'SELF_SIGNED_CERT_IN_CHAIN'}),'DB_TLS');
  assert.equal(readinessFailure({code:'ETIMEDOUT'}),'DB_NETWORK');
  for(const error of [null,undefined,'private credential',{code:'private credential',message:'private credential'}])assert.equal(readinessFailure(error),'DB_UNAVAILABLE');
});
