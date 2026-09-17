/** Explicit disposable test endpoints only. Caller/supervisor proves fresh CREATE.
 * A profile is an accident-prevention guard, not production authorization.
 */
import assert from 'node:assert/strict';
import type { PoolConfig } from 'pg';
export interface TextDraftTestProfile {
  readonly layout: 'public' | 'extensions';
  readonly connection: PoolConfig & { database: string; host: '127.0.0.1'; port: 5432 | 55439 };
}
export function textDraftTestProfile(env: NodeJS.ProcessEnv, databaseKey: 'TEXT_DRAFT_HTTP_DATABASE' | 'TEXT_DRAFT_CONCURRENCY_DATABASE', platform: NodeJS.Platform = process.platform): TextDraftTestProfile {
  assert.equal(env.TEXT_DRAFT_TEST_DISPOSABLE, '1');
  assert.ok(env.TEXT_DRAFT_TEST_LAYOUT === 'public' || env.TEXT_DRAFT_TEST_LAYOUT === 'extensions');
  const database = env[databaseKey]; assert.equal(typeof database, 'string');
  assert.ok(database && /^lumin_text_draft_[a-f0-9]{32}$/.test(database) && database.length === 49);
  let port: 5432 | 55439, password: string;
  if (env.TEXT_DRAFT_TEST_PROFILE === 'local') { assert.equal(platform, 'win32'); port = 55439; password = ''; }
  else { assert.equal(env.TEXT_DRAFT_TEST_PROFILE, 'github-ci'); assert.equal(platform, 'linux'); assert.equal(env.GITHUB_ACTIONS, 'true'); port = 5432; password = 'postgres'; }
  return Object.freeze({ layout: env.TEXT_DRAFT_TEST_LAYOUT, connection: Object.freeze({ host: '127.0.0.1' as const, port, user: 'postgres', database, password: async () => password, ssl: false as const, options: '', application_name: 'lumin_text_draft_disposable', connectionTimeoutMillis: 5000 }) });
}
export const textDraftDatabaseIdentitySql = "select current_database() as database, host(inet_server_addr()) as host, inet_server_port() as port, (select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto') as crypto_layout";
export async function verifyTextDraftDatabase(client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }, profile: TextDraftTestProfile): Promise<void> {
  const result = await client.query(textDraftDatabaseIdentitySql); assert.equal(result.rows.length, 1);
  const info = result.rows[0]!; assert.equal(info.database, profile.connection.database); assert.equal(info.host, profile.connection.host); assert.equal(info.port, profile.connection.port); assert.equal(info.crypto_layout, profile.layout);
}
