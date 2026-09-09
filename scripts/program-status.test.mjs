import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectProgram } from './program-status.mjs';
const fixture = () => ({ schemaVersion: 1, releaseBoundary: 'reviewed_candidates_only',
  requiredGates: ['builder','unit','domain','independent','adversarial','integration','runtime','ci','release'],
  waves: [
    {id:'W0',scope:'planning',status:'verified',dependsOn:[],evidence:'approval'},
    {id:'W1',scope:'candidate',status:'verified',dependsOn:['W0'],evidence:'review',candidate:'a'.repeat(40),ci:'https://github.com/example/repo/actions/runs/1',gates:['builder','unit','domain','independent','adversarial','integration','runtime','ci','release']},
    {id:'W2',scope:'candidate',status:'building',dependsOn:['W1']},
    {id:'W3',scope:'candidate',status:'planned',dependsOn:['W2']},
    {id:'W8',scope:'staging',status:'blocked',dependsOn:['W3'],blocker:'access'},
    {id:'W9',scope:'activation',status:'blocked',dependsOn:['W8'],blocker:'separate authorization'},
  ] });
test('ledger records active work without claiming deployment', () => {
  const result = inspectProgram(fixture()); assert.deepEqual(result.active, ['W2']); assert.deepEqual(result.verified, ['W0', 'W1']);
});
test('rejects cycles, missing dependencies and premature wave starts', () => {
  for (const mutate of [l => l.waves[0].dependsOn.push('W2'), l => l.waves[2].dependsOn.push('W99'), l => l.waves[3].status = 'building']) {
    const ledger = fixture(); mutate(ledger); assert.throws(() => inspectProgram(ledger));
  }
});
test('recorded completion requires every gate, commit and CI evidence', () => {
  for (const key of ['gates', 'candidate', 'ci', 'evidence']) { const ledger = fixture(); delete ledger.waves[1][key]; assert.throws(() => inspectProgram(ledger)); }
});
test('activation, duplicate IDs and silently removed gates fail closed', () => {
  for (const mutate of [l => l.waves[5].status = 'planned', l => l.waves[1].id = 'W0', l => l.requiredGates.pop()]) {
    const ledger = fixture(); mutate(ledger); assert.throws(() => inspectProgram(ledger));
  }
});
