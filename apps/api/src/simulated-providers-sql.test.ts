import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {SIMULATED_PROVIDERS} from './simulated-payment-readiness';

/**
 * The SQL provenance fixture asserts the simulated labels against a marked array literal: a
 * `-- SIMULATED_PROVIDERS-BEGIN` line, one quoted label per line, then `-- SIMULATED_PROVIDERS-END`.
 * This test reads that array and holds it to SIMULATED_PROVIDERS, the list the app-side readiness
 * guard asks the database about. A label added to one and not the other is a failing test.
 */
const FIXTURE = new URL('../../../supabase/tests/payment_provenance_tests.sql', import.meta.url);
const BEGIN = '-- SIMULATED_PROVIDERS-BEGIN';
const END = '-- SIMULATED_PROVIDERS-END';

/**
 * The labels between the markers, in the order written. Throws, and never returns an empty list,
 * when a marker is missing, repeated or out of order, or when a line between them is not one quoted label.
 */
function labelsBetweenMarkers(sql: string): string[] {
  const lines = sql.split('\n').map((line) => line.trim());
  const begins = lines.flatMap((line, index) => (line === BEGIN ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === END ? [index] : []));
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(
      `payment_provenance_tests.sql must contain exactly one ${BEGIN} and one ${END} line ` +
        `(found ${begins.length} and ${ends.length})`,
    );
  }
  const begin = begins[0]!;
  const end = ends[0]!;
  if (end <= begin) throw new Error(`${END} comes before ${BEGIN}`);
  // SQL joins two string literals across a newline, so a missing comma reads as ONE label ('a' 'b' is 'ab').
  // Every line but the last must end with a comma, and the last must not: that is the array PostgreSQL reads.
  const rows = lines.slice(begin + 1, end);
  const labels: string[] = [];
  rows.forEach((line, index) => {
    const match = /^'([a-z][a-z0-9_]*)'(,?)$/.exec(line);
    const last = index === rows.length - 1;
    if (!match || (match[2] === ',') === last) {
      throw new Error(
        `between the markers expected one quoted label per line, a comma after every label but the last; found: ${line || '(blank line)'}`,
      );
    }
    labels.push(match[1]!);
  });
  if (labels.length === 0) throw new Error(`${BEGIN} is followed by no labels`);
  return labels;
}

describe('the SQL provenance fixture names exactly the simulated providers', () => {
  it('holds the marked array to SIMULATED_PROVIDERS: the same set, and the same count', () => {
    const labels = labelsBetweenMarkers(readFileSync(FIXTURE, 'utf8'));
    expect(labels.length, 'label count').toBe(SIMULATED_PROVIDERS.length);
    expect([...labels].sort(), 'labels').toEqual([...SIMULATED_PROVIDERS].sort());
  });

  it('checks the same array the service_role assertion uses, not a copy beside it', () => {
    // The marked block must be the argument of the any(...) inside the statement that carries the
    // service_role label. A second copy elsewhere in the file, or a marked block beside an unmarked
    // list in that statement, does not satisfy this.
    const sql = readFileSync(FIXTURE, 'utf8');
    const label = sql.indexOf("'service_role sees the simulated-provider rows");
    expect(label, 'the service_role assertion is in the fixture').toBeGreaterThan(-1);
    const statement = sql.slice(sql.lastIndexOf('select pg_temp.assert(', label), label);
    expect(statement, 'the marked block is the array the assertion evaluates').toMatch(
      /where provider = any\(array\[\s*\n-- SIMULATED_PROVIDERS-BEGIN\n[\s\S]*\n-- SIMULATED_PROVIDERS-END\n\]::text\[\]\)\)/,
    );
  });

  it('fails loudly when a marker is missing, rather than reading as an empty list', () => {
    expect(() => labelsBetweenMarkers('select 1;\n')).toThrow(/exactly one/);
    expect(() => labelsBetweenMarkers(`${BEGIN}\n'fixture',\n`)).toThrow(/exactly one/);
  });

  it('fails loudly on a line between the markers that is not one quoted label', () => {
    expect(() => labelsBetweenMarkers(`${BEGIN}\n 'staging_mock' 'fixture'\n${END}`)).toThrow(/one quoted label per line/);
    expect(() => labelsBetweenMarkers(`${BEGIN}\n 'Fixture',\n${END}`)).toThrow(/one quoted label per line/);
  });

  it('refuses a missing comma, which PostgreSQL reads as one label, and a trailing comma', () => {
    // 'staging_mock' followed by a newline and 'fixture' is the array {staging_mockfixture}: one label.
    expect(() => labelsBetweenMarkers(`${BEGIN}\n'staging_mock'\n'fixture',\n${END}`)).toThrow(/comma after every label/);
    expect(() => labelsBetweenMarkers(`${BEGIN}\n'staging_mock',\n'fixture',\n${END}`)).toThrow(/comma after every label/);
    expect(labelsBetweenMarkers(`${BEGIN}\n'staging_mock',\n'fixture'\n${END}`)).toEqual(['staging_mock', 'fixture']);
  });
});
