import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectProgram } from './program-status.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../docs/product/wave-ledger.json',import.meta.url),'utf8'));
const node=(ledger,id)=>ledger.nodes.find(n=>n.id===id);
const wave=(ledger,id)=>ledger.waves.find(n=>n.id===id);
const review=(ledger,item)=>Object.assign(item,{status:'verified',candidate:'b'.repeat(40),gates:[...ledger.requiredGates],evidence:'https://github.com/ailuminagency-work/booking-lumin-checkout/pull/999',ci:'https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/999'});
function hosted(ledger,item){review(ledger,item);item.hostedEvidence={environment:'staging',candidate:item.candidate,url:'https://evidence.bookinglumin.com/reviews/fixture-only',reviewedBy:'independent-test-fixture'};}
function fullW3(){const ledger=fixture();for(const id of ['W3.fields_and_workflows','W3.publication_and_installation','W3.runtime_and_presets'])review(ledger,node(ledger,id));hosted(ledger,node(ledger,'E.environment_access'));hosted(ledger,node(ledger,'W3.hosted_request_acceptance'));return ledger;}

test('records local candidate without full W3 completion and unlocks dependent implementation only',()=>{
 const result=inspectProgram(fixture());assert.deepEqual(result.verified,['W0','W1','W2']);assert.deepEqual(result.verifiedNodes,['W3.1.local_candidate']);assert(result.active.includes('W3'));assert(result.readyNodes.includes('W4.implementation'));assert(!result.ready.includes('W4'));assert(!result.readyNodes.includes('W8.integrated_pilot'));
 const ledger=fixture();node(ledger,'W4.implementation').status='building';wave(ledger,'W4').status='building';assert(inspectProgram(ledger).active.includes('W4'));assert.equal(wave(ledger,'W3').status,'building');
});
test('full parent requires every capability and hosted acceptance, then its own full receipt',()=>{
 const partial=fixture();review(partial,wave(partial,'W3'));assert.throws(()=>inspectProgram(partial),/completion/);
 const complete=fullW3();review(complete,wave(complete,'W3'));assert(inspectProgram(complete).verified.includes('W3'));
 for(const id of wave(complete,'W3').requires){const bad=structuredClone(complete);node(bad,id).status='planned';assert.throws(()=>inspectProgram(bad));}
});
test('cannot remove or reclassify mandatory acceptance, parents or gates',()=>{
 const mutations=[l=>wave(l,'W3').requires.pop(),l=>delete wave(l,'W3').requires,l=>l.nodes.splice(l.nodes.findIndex(n=>n.id==='W3.hosted_request_acceptance'),1),l=>node(l,'W3.hosted_request_acceptance').kind='implementation',l=>wave(l,'W3').scope='planning',l=>l.waves.pop(),l=>l.requiredGates.pop(),l=>wave(l,'W9').status='planned'];
 for(const mutate of mutations){const ledger=fixture();mutate(ledger);assert.throws(()=>inspectProgram(ledger));}
});
test('rejects unknown IDs/fields, combined dependency cycles and dependency weakening',()=>{
 for(const mutate of [l=>node(l,'W4.implementation').dependsOn.push('W99'),l=>node(l,'W3.1.local_candidate').dependsOn.push('W3'),l=>node(l,'E.environment_access').dependsOn.push('W8'),l=>node(l,'W8.integrated_pilot').dependsOn=['W8'],l=>wave(l,'W4').dependsOn=['W2'],l=>node(l,'W4.implementation').dependsOn=[],l=>node(l,'W3.1.local_candidate').complete=true,l=>l.nodes.push({...node(l,'W4.implementation'),id:'W4.any',dependsOn:[],status:'building'})]){
  const ledger=fixture();mutate(ledger);assert.throws(()=>inspectProgram(ledger));
 }
});
test('a fabricated implementation extension cannot start W7 or complete its parent',()=>{
 const ledger=fixture();ledger.nodes.push({id:'W7.any',kind:'implementation',owner:'W7',status:'building',dependsOn:[],acceptance:'forged readiness'});wave(ledger,'W7').status='building';assert.throws(()=>inspectProgram(ledger));
 const other=fixture();wave(other,'W7').status='building';assert.throws(()=>inspectProgram(other),/readiness/);
});
test('candidate receipts require exact repository CI URL, SHA and all distinct gates',()=>{
 for(const target of [l=>wave(l,'W1'),l=>node(l,'W3.1.local_candidate')]){
  for(const key of ['candidate','ci','gates','evidence']){const ledger=fixture();delete target(ledger)[key];assert.throws(()=>inspectProgram(ledger));}
  for(const bad of ['https://github.com.attacker.test/ailuminagency-work/booking-lumin-checkout/actions/runs/1','https://github.com/other/repo/actions/runs/1','https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/1?fake=true']){const ledger=fixture();target(ledger).ci=bad;assert.throws(()=>inspectProgram(ledger));}
  for(const bad of ['builderunitdomainindependentadversarialintegrationruntimecirelease',[...fixture().requiredGates,'unit']]){const ledger=fixture();target(ledger).gates=bad;assert.throws(()=>inspectProgram(ledger));}
 }
});
test('hosted acceptance rejects missing proof, local/fixture hosts, self PR/CI/ledger receipts and wrong SHA',()=>{
 for(const url of ['http://evidence.bookinglumin.com/proof','https://localhost/proof','https://127.0.0.1/proof','https://10.0.0.1/proof','https://[::1]/proof','https://booking.local.test/proof','https://example.com/proof','https://github.com/ailuminagency-work/booking-lumin-checkout/pull/999','https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/999','https://evidence.bookinglumin.com/wave-ledger.json']){
  const ledger=fullW3();node(ledger,'W3.hosted_request_acceptance').hostedEvidence.url=url;assert.throws(()=>inspectProgram(ledger));
 }
 for(const mutate of [n=>delete n.hostedEvidence,n=>n.hostedEvidence.candidate='c'.repeat(40),n=>n.hostedEvidence.environment='local',n=>n.hostedEvidence.reviewedBy='',n=>n.evidence='docs/product/wave-ledger.json',n=>n.evidence=n.id]){const ledger=fullW3();mutate(node(ledger,'W3.hosted_request_acceptance'));assert.throws(()=>inspectProgram(ledger));}
});
test('W8 pilot depends on hosted W3-W7 evidence, never early infrastructure access',()=>{
 const ledger=fixture();hosted(ledger,node(ledger,'E.environment_access'));assert(!inspectProgram(ledger).readyNodes.includes('W8.integrated_pilot'));
 node(ledger,'W8.integrated_pilot').status='building';assert.throws(()=>inspectProgram(ledger));
});
