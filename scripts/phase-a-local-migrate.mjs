import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');
const HARNESS = resolve(ROOT, 'supabase', 'tests', 'local_harness.sql');
const DB_NAME = /^lumin_phase_a_[a-z0-9_]{1,40}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);
const BLOCKED = ['DATABASE_URL', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'];

function validateEnv(env) {
  if (env.PHASE_A_LOCAL_MIGRATE !== '1') throw new Error('CONFIG: set PHASE_A_LOCAL_MIGRATE=1 to apply local migrations');
  if (BLOCKED.some(key => env[key])) throw new Error('CONFIG: connection override is not permitted');
  const host = env.PGHOST ?? '127.0.0.1';
  const address = env.PGHOSTADDR;
  if (!LOOPBACK.has(host) || (address && address !== '127.0.0.1')) throw new Error('CONFIG: PostgreSQL host must be loopback');
  if (!env.PGDATABASE || !DB_NAME.test(env.PGDATABASE)) throw new Error('CONFIG: PGDATABASE must use lumin_phase_a_ prefix');
  const port = env.PGPORT ?? '5432';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('CONFIG: invalid PGPORT');
  return { host, port, user: env.PGUSER ?? 'postgres', database: env.PGDATABASE, psql: env.PSQL_BIN ?? 'psql' };
}

async function migrationFiles() {
  const names = (await readdir(MIGRATIONS)).filter(name => /^0\d+_.+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('CONFIG: no migrations found');
  return names.map(name => join(MIGRATIONS, name));
}

async function applyFile(config, file) {
  await execFileAsync(config.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', config.host, '-p', config.port, '-U', config.user, '-d', config.database, '-f', file], { cwd: ROOT, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ComSpec: process.env.ComSpec ?? '' }, windowsHide: true, maxBuffer: 1024 * 1024 });
}

export async function runLocalMigrations(env = process.env, { log = console.log, apply = applyFile } = {}) {
  const config = validateEnv(env);
  const files = [HARNESS, ...(await migrationFiles())];
  for (const file of files) {
    log(`APPLY ${file.slice(ROOT.length + 1)}`);
    await apply(config, file);
  }
  log(`PASS local Phase A migration replay (${files.length} SQL files)`);
  return files;
}

async function selfTest() {
  const safe = { PHASE_A_LOCAL_MIGRATE: '1', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'lumin_phase_a_selftest' };
  const seen = [];
  const apply = async (config, file) => seen.push({ config, file });
  const files = await runLocalMigrations(safe, { apply, log: () => {} });
  assert.equal(files[0], HARNESS);
  assert.deepEqual(files.slice(1).map(file => file.split(/[\\/]/).at(-1)), [...files.slice(1).map(file => file.split(/[\\/]/).at(-1))].sort());
  assert.equal(seen.length, files.length);
  for (const bad of [
    { ...safe, PHASE_A_LOCAL_MIGRATE: undefined },
    { ...safe, PGHOST: 'db.example.test' },
    { ...safe, PGHOSTADDR: '10.0.0.4' },
    { ...safe, PGDATABASE: 'postgres' },
    { ...safe, DATABASE_URL: 'postgres://redacted' },
    { ...safe, PGSERVICE: 'remote-service' },
  ]) await assert.rejects(runLocalMigrations(bad, { apply: () => { throw new Error('must not apply'); }, log: () => {} }), /CONFIG/);
  console.log('PASS offline local migration self-test: explicit opt-in, loopback, disposable database, ordering, no network');
}

const help = `Usage: npm run migrate:phase-a -- [--help|--self-test]
Applies the local harness and checked-in migrations only to an existing loopback
database named lumin_phase_a_*. Requires PHASE_A_LOCAL_MIGRATE=1. No DATABASE_URL,
service file, password file, remote host, or live database name is accepted.`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else if (args.length === 1 && args[0] === '--self-test') await selfTest();
    else if (args.length) throw new Error('CONFIG: unsupported arguments; use --help');
    else await runLocalMigrations();
  } catch (error) { console.error(error instanceof Error ? error.message : 'local migration failed'); process.exitCode = 1; }
}
