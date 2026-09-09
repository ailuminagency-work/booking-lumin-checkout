import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const gates = ['builder', 'unit', 'domain', 'independent', 'adversarial', 'integration', 'runtime', 'ci', 'release'];
/** Read-only ledger validation. This checks recorded structure, never certifies evidence. */
export function inspectProgram(ledger) {
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger.waves) || ledger.waves.length === 0) throw new Error('Invalid wave ledger');
  if (ledger.releaseBoundary !== 'reviewed_candidates_only') throw new Error('Unexpected release boundary');
  if (JSON.stringify(ledger.requiredGates) !== JSON.stringify(gates)) throw new Error('Required gates changed');
  const byId = new Map();
  for (const wave of ledger.waves) {
    if (!/^W\d+$/.test(wave.id) || byId.has(wave.id)) throw new Error('Duplicate or invalid wave ID');
    if (!Array.isArray(wave.dependsOn) || new Set(wave.dependsOn).size !== wave.dependsOn.length) throw new Error('Invalid dependencies');
    if (!['planned', 'building', 'rework', 'verified', 'blocked'].includes(wave.status)) throw new Error('Invalid wave status');
    if (!['planning', 'candidate', 'staging', 'activation'].includes(wave.scope)) throw new Error('Invalid wave scope');
    if ((wave.id === 'W0') !== (wave.scope === 'planning')) throw new Error('Only W0 is exempt from implementation gates');
    if (wave.status === 'blocked' && !wave.blocker?.trim()) throw new Error('Blocked wave needs a reason');
    if (wave.scope === 'activation' && wave.status !== 'blocked') throw new Error('Activation requires a separately reviewed authorization change');
    if (wave.status === 'verified') {
      if (!wave.evidence?.trim()) throw new Error('Verified wave needs evidence');
      if (wave.scope !== 'planning' && (!/^[a-f0-9]{40}$/.test(wave.candidate ?? '') || !wave.ci?.startsWith('https://github.com/') || !Array.isArray(wave.gates) || wave.gates.length !== gates.length || new Set(wave.gates).size !== gates.length || !gates.every(g => wave.gates.includes(g)))) throw new Error('Verified candidate lacks gate evidence');
    }
    byId.set(wave.id, wave);
  }
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Dependency cycle');
    if (visited.has(id)) return;
    const wave = byId.get(id); if (!wave) throw new Error('Unknown dependency');
    visiting.add(id); for (const dep of wave.dependsOn) visit(dep);
    visiting.delete(id); visited.add(id);
    if (['building', 'verified'].includes(wave.status) && wave.dependsOn.some(dep => byId.get(dep).status !== 'verified')) throw new Error('Started wave has unverified dependencies');
  }
  for (const id of byId.keys()) visit(id);
  return {
    ready: ledger.waves.filter(w => ['planned', 'rework'].includes(w.status) && w.dependsOn.every(id => byId.get(id).status === 'verified')).map(w => w.id),
    active: ledger.waves.filter(w => w.status === 'building').map(w => w.id),
    blocked: ledger.waves.filter(w => w.status === 'blocked').map(w => ({ id: w.id, reason: w.blocker })),
    verified: ledger.waves.filter(w => w.status === 'verified').map(w => w.id),
    note: 'Recorded candidate status only; evidence must be independently verified before release.',
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(inspectProgram(JSON.parse(readFileSync(new URL('../docs/product/wave-ledger.json', import.meta.url), 'utf8'))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
