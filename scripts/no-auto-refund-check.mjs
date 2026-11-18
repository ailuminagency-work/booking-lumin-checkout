/** Fail-closed provider-refund guard. Run after npm ci (TypeScript is locked). */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const OBSERVER = 'packages/adapters/src/stripeRefundObservation.internal.ts';
// Reviewed d0ef2e3 observer ONLY. Any AST change requires a fresh safety review;
// this is not a path allowlist and is not general JavaScript effect analysis.
const REVIEWED_AST_SHA256 = 'cf6079df7f3e03c262fe1d4c598a9bf40a189af01847a14d042e9c4ee97c0ae3';
export function observerFingerprint(source) {
  const tree = ts.createSourceFile(OBSERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) throw new Error('observer parse failure');
  const printed = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(tree);
  return createHash('sha256').update(printed).digest('hex');
}
export function validateObserver(source) {
  try {
    if (observerFingerprint(source) !== REVIEWED_AST_SHA256) return false;
    const tree = ts.createSourceFile(OBSERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let calls = 0, getMethods = 0, imports = 0;
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) imports++;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'transport') calls++;
      if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'method' && ts.isStringLiteral(node.initializer) && node.initializer.text === 'GET') getMethods++;
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return calls === 1 && getMethods === 1 && imports === 0;
  } catch { return false; }
}
const isTest = name => /\/test\//.test(name) || /\.test\.ts$/.test(name) || /\/fakeStripe\.ts$/.test(name);
export function inspectFiles(files) {
  const failures = [];
  for (const [name, source] of files) {
    if (isTest(name)) continue;
    if (name === OBSERVER) {
      if (!validateObserver(source)) failures.push(`${name}: read-only observer differs from reviewed AST or GET-only boundary`);
      continue;
    }
    // No production consumer/re-export: observer is dormant, injected-transport
    // only. Conservative textual match also rejects computed literal imports.
    if (source.includes('stripeRefundObservation')) failures.push(`${name}: dormant observer must not have a production consumer/export`);
    source.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      if (/\.refund\s*\(|\.refunds\s*\.\s*create\s*\(|v1\/refunds/.test(line)) failures.push(`${name}:${index + 1}: provider refund primitive/endpoint is forbidden`);
    });
  }
  return failures;
}
export function scan(root) {
  const files = new Map();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('refusing symlink in source scan');
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?tsx?$/.test(entry.name)) files.set(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
    }
  }
  for (const dir of ['supabase/functions', 'packages', 'apps']) walk(path.join(root, dir));
  return inspectFiles(files);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const failures = scan(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    if (failures.length) { console.error('no-auto-refund-check: FAIL\n' + failures.join('\n')); process.exitCode = 1; }
    else console.log('no-auto-refund-check: clean (no refund creation; reviewed dormant GET-only observer)');
  } catch (error) { console.error('no-auto-refund-check: FAIL', error.message); process.exitCode = 1; }
}
