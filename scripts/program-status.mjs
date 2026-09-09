import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isIP } from 'node:net';

const gates = ['builder', 'unit', 'domain', 'independent', 'adversarial', 'integration', 'runtime', 'ci', 'release'];
const repository = 'ailuminagency-work/booking-lumin-checkout';
const waveDependencies = [[], ['W0'], ['W1'], ['W2'], ['W2','W3'], ['W2','W4'], ['W2','W5'], ['W3','W4','W5','W6'], ['W7'], ['W8']];
const completions = {
  W3: ['W3.fields_and_workflows','W3.publication_and_installation','W3.runtime_and_presets','W3.hosted_request_acceptance'],
  ...Object.fromEntries([4,5,6,7].map(n => [`W${n}`, [`W${n}.capabilities`,`W${n}.hosted_acceptance`]])),
  W8: ['W8.integrated_pilot'],
};
const coreNodes = {
  'W3.1.local_candidate': {kind:'implementation',owner:'W3',dependsOn:['W2']},
  'W3.2.local_candidate': {kind:'implementation',owner:'W3',dependsOn:['W3.1.local_candidate']},
  'E.environment_access': {kind:'external',owner:null,dependsOn:[]},
  ...Object.fromEntries(['fields_and_workflows','publication_and_installation','runtime_and_presets'].map(name => [`W3.${name}`, {kind:'capability',owner:'W3',dependsOn:['W3.1.local_candidate']}])),
  'W3.hosted_request_acceptance': {kind:'hosted',owner:'W3',dependsOn:['E.environment_access',...completions.W3.slice(0,-1)]},
  ...Object.fromEntries([4,5,6,7].flatMap(n => [
    [`W${n}.implementation`, {kind:'implementation',owner:`W${n}`,dependsOn:n===4?['W2','W3.1.local_candidate']:n===7?['W3.1.local_candidate','W4.implementation','W5.implementation','W6.implementation']:['W2',`W${n-1}.implementation`]}],
    [`W${n}.capabilities`, {kind:'capability',owner:`W${n}`,dependsOn:[`W${n}.implementation`]}],
    [`W${n}.hosted_acceptance`, {kind:'hosted',owner:`W${n}`,dependsOn:['E.environment_access',`W${n}.capabilities`]}],
  ])),
  'W8.integrated_pilot': {kind:'hosted',owner:'W8',dependsOn:['W3.hosted_request_acceptance',...['W4','W5','W6','W7'].map(w=>`${w}.hosted_acceptance`)]},
};
function knownFields(item, allowed) { if (Object.keys(item).some(key=>!allowed.includes(key))) throw new Error('Unknown ledger field'); }
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const same = (actual, expected) => Array.isArray(actual) && actual.length===expected.length && new Set(actual).size===actual.length && expected.every(x=>actual.includes(x));
function dependencies(value) {
  if (!Array.isArray(value) || value.some(x=>!nonempty(x)) || new Set(value).size!==value.length) throw new Error('Invalid dependencies');
}
function status(item) {
  if (!['planned','building','rework','verified','blocked'].includes(item.status)) throw new Error('Invalid status');
  if (item.status==='blocked' && !nonempty(item.blocker)) throw new Error('Blocked item needs a reason');
}
function receipt(item) {
  if (!/^[a-f0-9]{40}$/.test(item.candidate??'') || !same(item.gates,gates)
    || !new RegExp(`^https://github\\.com/${repository}/pull/[1-9][0-9]*$`).test(item.evidence??'')
    || !new RegExp(`^https://github\\.com/${repository}/actions/runs/[1-9][0-9]*$`).test(item.ci??'')) throw new Error('Verified candidate lacks gate evidence');
}
function publicProofHost(host) {
  host=host.replace(/^\[|\]$/g,'').toLowerCase();
  if (!host.includes('.') || /(^|\.)(localhost|local|test|invalid|example)$/.test(host) || /(^|\.)example\.(com|net|org)$/.test(host)) return false;
  if (isIP(host)===6) return false; // Evidence links must use a public DNS hostname.
  if (isIP(host)===4) return false; // No IP literals, including encoded loopback/private forms.
  return true;
}
function hostedReceipt(item) {
  const proof=item.hostedEvidence;
  if (!proof || typeof proof!=='object') throw new Error('Missing hosted evidence');
  knownFields(proof,['url','environment','candidate','reviewedBy']);
  let url; try { url=new URL(proof?.url); } catch { throw new Error('Missing hosted evidence'); }
  if (proof.environment!=='staging' || proof.candidate!==item.candidate || !nonempty(proof.reviewedBy)
    || url.protocol!=='https:' || url.username || url.password || !publicProofHost(url.hostname) || proof.url===item.evidence || proof.url===item.ci
    || (url.hostname==='github.com' && (/\/pull\/[0-9]+(?:\/|$)/.test(url.pathname) || /\/actions\/runs\/[0-9]+\/?$/.test(url.pathname)))
    || /wave-ledger|program-status|EXECUTION_WORKFLOW/i.test(proof.url)) throw new Error('Hosted evidence cannot be a local or self receipt');
}
/** Structural validation only: it does not authenticate CI, reviewers or hosted proof.
 * Never cite this command's own success as evidence that a node passed its gates. */
export function inspectProgram(ledger) {
  if (ledger?.schemaVersion!==2 || ledger.repository!==repository || !Array.isArray(ledger.waves) || ledger.waves.length!==10 || !Array.isArray(ledger.nodes)) throw new Error('Invalid wave ledger');
  knownFields(ledger,['schemaVersion','repository','releaseBoundary','requiredGates','waves','nodes']);
  if (ledger.releaseBoundary!=='reviewed_candidates_only') throw new Error('Unexpected release boundary');
  if (JSON.stringify(ledger.requiredGates)!==JSON.stringify(gates)) throw new Error('Required gates changed');
  const byId=new Map();
  for (const wave of ledger.waves) {
    knownFields(wave,['id','name','scope','status','dependsOn','requires','blocker','candidate','ci','gates','evidence','deployment','branch','owners']);
    if (!/^W[0-9]$/.test(wave.id) || byId.has(wave.id)) throw new Error('Duplicate or invalid wave ID');
    const n=Number(wave.id.slice(1));
    if (wave.scope!==(n===0?'planning':n===8?'staging':n===9?'activation':'candidate')) throw new Error('Wave scope changed');
    if (!same(wave.dependsOn,waveDependencies[n])) throw new Error('Parent dependencies changed');
    if (!same(wave.requires??[],completions[wave.id]??[])) throw new Error('Parent completion requirements changed');
    status(wave);
    if (n===9 && wave.status!=='blocked') throw new Error('Activation requires a separately reviewed authorization change');
    if (wave.status==='verified') { if (n===0) {if (!nonempty(wave.evidence)) throw new Error('Approval evidence missing');} else receipt(wave); }
    byId.set(wave.id,wave);
  }
  for (const node of ledger.nodes) {
    knownFields(node,['id','kind','owner','status','dependsOn','acceptance','blocker','candidate','ci','gates','evidence','deployment','hostedEvidence']);
    if (!/^(W[3-8]\.[a-z0-9_.]+|E\.environment_access)$/.test(node.id) || byId.has(node.id)) throw new Error('Duplicate or invalid evidence node');
    status(node); dependencies(node.dependsOn);
    if (!['implementation','capability','hosted','external'].includes(node.kind) || (node.kind==='external')!==(node.id==='E.environment_access')
      || node.owner!==(node.kind==='external'?null:node.id.split('.')[0]) || !nonempty(node.acceptance)) throw new Error('Invalid evidence node scope');
    const core=coreNodes[node.id];
    if (!core) throw new Error('Unknown evidence node');
    if (core && (node.kind!==core.kind || node.owner!==core.owner || !same(node.dependsOn,core.dependsOn))) throw new Error('Required evidence dependency changed');
    if (node.status==='verified') { receipt(node); if (['hosted','external'].includes(node.kind)) hostedReceipt(node); }
    byId.set(node.id,node);
  }
  for (const id of Object.keys(coreNodes)) if (!byId.has(id)) throw new Error('Required evidence node missing');
  // External access preparation must not wait for an implementation wave/pilot.
  if (byId.get('E.environment_access').dependsOn.length) throw new Error('Environment prerequisite cannot depend on waves');
  const visiting=new Set(),visited=new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Dependency cycle');
    if (visited.has(id)) return;
    const item=byId.get(id); if (!item) throw new Error('Unknown dependency');
    visiting.add(id);
    for (const dep of [...item.dependsOn,...(item.requires??[])]) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  const passed=id=>byId.get(id).status==='verified';
  for (const node of ledger.nodes) if (['building','verified'].includes(node.status) && !node.dependsOn.every(passed)) throw new Error('Started node has unverified dependencies');
  for (const wave of ledger.waves) {
    if (wave.status==='verified' && ![...wave.dependsOn,...(wave.requires??[])].every(passed)) throw new Error('Parent completion lacks required acceptance');
    if (wave.status==='building' && !wave.dependsOn.every(passed) && !['building','verified'].includes(byId.get(`${wave.id}.implementation`)?.status)) throw new Error('Started parent has no reviewed implementation readiness');
  }
  return {
    ready: ledger.waves.filter(w=>['planned','rework'].includes(w.status)&&w.dependsOn.every(passed)).map(w=>w.id),
    readyNodes: ledger.nodes.filter(n=>['planned','rework'].includes(n.status)&&n.dependsOn.every(passed)).map(n=>n.id),
    active: ledger.waves.filter(w=>w.status==='building').map(w=>w.id),
    activeNodes: ledger.nodes.filter(n=>n.status==='building').map(n=>n.id),
    blocked: [...ledger.waves,...ledger.nodes].filter(n=>n.status==='blocked').map(n=>({id:n.id,reason:n.blocker})),
    verified: ledger.waves.filter(w=>w.status==='verified').map(w=>w.id),
    verifiedNodes: ledger.nodes.filter(n=>n.status==='verified').map(n=>n.id),
    note:'Recorded structure only; independently verify external receipts. Local implementation readiness never completes a parent or authorizes deployment/providers.',
  };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(inspectProgram(JSON.parse(readFileSync(new URL('../docs/product/wave-ledger.json',import.meta.url),'utf8'))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
