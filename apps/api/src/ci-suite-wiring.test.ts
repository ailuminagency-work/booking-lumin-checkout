import {afterAll, describe, expect, it} from 'vitest';
import {spawn} from 'node:child_process';
import {chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * CI runs every SQL suite under supabase/tests, and a failing suite must fail the database job.
 *
 * The database job runs its domain suites from one shell loop (`for s in \ ... ; do`), and runs some suites in their
 * own steps, each by a literal `supabase/tests/<name>.sql` path. Three things are checked.
 *
 *   1. WIRING. Every suite is named by the domain loop or by a psql line of the database job, or is included by a wired
 *      suite with a bare `\i name.sql` or `\ir name.sql` that psql would run (not one in a comment or a string). A name,
 *      path or include with no file behind it fails too. A suite that only another job runs counts as unwired.
 *   2. SHAPE. The database job's text cannot skip work or hide a failure. It is read the way bash, YAML and psql read it:
 *      a # inside quotes is content, a backslash escapes outside single quotes, a run value's continuation lines are read
 *      as part of it, and the lines of a block scalar are read even with an indentation digit. Each command is read on its
 *      own, including the commands inside $( ) and backticks. A command substitution or a quotation that is not closed on
 *      its line is refused, since bash would read the next line as part of it. The job may run only these commands: psql,
 *      node, npx, npm ci, echo, export (without options), createdb, [[ (its inside is not split), set -euo pipefail, exit 1
 *      to 9, docker inspect, and the loop words. Any other command is refused, including a builtin, a shell, a wrapper, set
 *      +e, shopt, cd, eval and exec. A here-document, a backtick, ANSI-C quoting ($'...'), check_asserts, ALTER DATABASE,
 *      ALTER ROLE and ALTER SYSTEM are refused in the job. A suite path may appear only as the -f file of a psql call that
 *      runs it. The job may not have: a condition, continue-on-error, a custom shell, defaults, a container, a service
 *      image other than postgres:16, a runner other than ubuntu, a local action or reusable workflow, or an action other
 *      than actions/checkout and actions/setup-node; a GitHub expression other than the postgres service id (GitHub
 *      evaluates an expression before bash reads the step); a folded (>) run block, which joins its lines in YAML; a YAML
 *      anchor or alias; an environment variable, file or setting that changes psql or the shell (PSQLRC, psqlrc, BASH_ENV,
 *      PATH, HOME, GITHUB_PATH, BASH_FUNC_, LD_PRELOAD, LD_LIBRARY_PATH, LD_AUDIT, SHELLOPTS, BASHOPTS, PGOPTIONS, PGSERVICE,
 *      PGSERVICEFILE, PGHOSTADDR, PGPASSFILE, DATABASE_URL, ...); a loop other than the domain, migration and
 *      routing-override loops (a loop is any `for` that starts a command), and a second domain loop; a shell escape
 *      (continue, exit that is not a failure, set +e, negation, eval, source, if, while, until, case, select, coproc,
 *      alias, hash, enable, export -f, ...); a function (a name with empty parentheses, whatever its body); or a ||
 *      fallback that does not fail. A line that ends in &&, || or | continues on the next line, and the lines are checked
 *      together. A line that names a suite may not be part of an && list. A cd, a file write (cp, mv, tee, git, sed -i,
 *      ...) or a redirection to a file is refused.
 *      A psql call that runs a suite is only the plain form: -X, -v ON_ERROR_STOP=1 once (the name is case-sensitive),
 *      -d with a plain database name, exactly one -f suite (or the domain runner's path), and -c only for the lumin
 *      settings the suites read. A -c before a -f, -l, -V, --, -F, -o, a connection string in -d, or a second file is
 *      refused. It has no pipe or background job, and no psql backslash command other than an include of a suite. A path
 *      under supabase/tests must be a plain name.sql. A path to psql, or a write over it, is refused.
 *      SQL may not end psql early (\q, \quit), switch ON_ERROR_STOP off (\unset, or \set to a value other than on, 1,
 *      true or yes, quoted or not), set variables from a query (\gset, \prompt), run a shell command (\!), or include a
 *      file by any name but a bare name.sql. A suite may use only the meta-commands \set, \echo, \qecho, \i and \ir; a
 *      backtick, \o, \w and the other meta-commands that write files or run a shell are refused, and so are check_asserts,
 *      ALTER DATABASE, ALTER ROLE and ALTER SYSTEM where they are written out. Comments are skipped as psql skips them.
 *      String literals, quoted names and dollar-quoted bodies are read too, so one that names a command is refused.
 *   3. BEHAVIOUR. The domain loop, and each psql line that runs a suite, is run under bash -e, the way CI runs a run
 *      step, with a stand-in psql first on PATH that exits as psql does for the forms CI uses. With every suite passing,
 *      each must succeed. With a suite failing, the loop and the line that runs that suite must fail. This does not
 *      depend on spotting a spelling of a shell escape, so the text rules are a first line of defence, not the last.
 *
 * Not checked, for review: what a suite asserts (SQL semantics, including a suite that asserts nothing, RAISE NOTICE
 * standing in for RAISE EXCEPTION, and a DO block that swallows an error); a setting that a suite builds at run time
 * (EXECUTE, or set_config with a name made from parts), and a SET other than check_asserts written out; the other jobs,
 * including acceptance, and the six deferred TypeScript integration harnesses listed in
 * apps/api/scripts/run-integration.sh; supabase/tests/capacity_concurrency_harness.sh, which CI does not run; the programs
 * the job runs, node and npx (the integration scripts) and npm ci (package install scripts), which are repository code
 * and not text the guard reads; the migrations the loop applies before the suites; the server the job reaches through
 * PGHOST, PGPORT, PGUSER and PGDATABASE, which it sets; the runner's own environment, including a ~/.psqlrc, which the
 * domain runner would read (it runs psql without -X), and any service file on the runner; a suite deleted together with
 * its loop entry; the code of the actions checkout and setup-node, pinned by commit; and a command moved out of the
 * database job. The guard assumes GitHub runs a run step as `bash -e`, which holds while the workflow sets no shell (a
 * shell setting is refused).
 *
 * It is deliberately strict. A change that trips a rule is a decision about CI: change the rule here, in the same
 * commit, and say why.
 */

const WORKFLOW = new URL('../../../.github/workflows/ci.yml', import.meta.url);
const SUITES = new URL('../../../supabase/tests/', import.meta.url);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The one command the domain loop runs for each suite, and the one line it echoes first. */
const RUNNER = 'psql -v ON_ERROR_STOP=1 -d lumin_test -f "supabase/tests/${s}.sql"';
const RUNNER_ECHO = 'echo "running $s"';
/** A suite named by a literal path, with the file name ending where the name ends. */
const SUITE_PATH = /supabase\/tests\/([A-Za-z0-9_]+)\.sql(?![A-Za-z0-9_.-])/g;

/**
 * The workflow as CI reads it: CRLF folded, whole-line comments removed, and a trailing comment cut where its # starts a
 * comment. A # inside single or double quotes is content, in YAML and in the shell, so it cuts nothing.
 */
function codeLines(workflow: string): string[] {
  return workflow
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => cutComment(line).trimEnd());
}

/** The line up to the # that starts a comment: a # after white space and outside quotes. A backslash escapes the next
 * character outside single quotes, so an escaped quote does not open a quotation. */
function cutComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote !== '') {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '\\') {
      i++;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line.charAt(i - 1)))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The lines of one top-level job: from its `  <name>:` line to the next job key, or the end. */
function jobLines(lines: string[], name: string): string[] {
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`the ${name} job was not found in the workflow`);
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^  [A-Za-z0-9_-]+:$/.test(line));
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The shell text of the run steps: the value of `run:`, or the block under `run: |`, trimmed line by line. Step
 * names and other keys are not shell, so they are not read here.
 */
function runText(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)((?:-\s+)?)run:\s*(.*)$/.exec(lines[i]!);
    if (!match) continue;
    // The column of the run key: a list item's key sits after its dash, and the lines of its value sit below it.
    const keyColumn = match[1]!.length + match[2]!.length;
    const value = match[3]!.trim();
    // A block scalar, with an optional indentation digit and chomping sign in either order, is read line by line.
    if (/^[|>](?:[1-9][-+]?|[-+][1-9]?)?$/.test(value)) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]!;
        if (line.trim() === '') continue;
        if (line.length - line.trimStart().length <= keyColumn) break;
        out.push(line.trim());
      }
    } else if (value.length > 0) {
      // A plain or quoted value may continue on more indented lines; YAML folds them into the value, so they are read as one line.
      const parts = [value];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]!;
        if (line.trim() === '') continue;
        if (line.length - line.trimStart().length <= keyColumn) break;
        parts.push(line.trim());
      }
      out.push(parts.join(' '));
    }
  }
  return out;
}

/** The indentation of a line, in spaces. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Logical lines: a line that ends in a backslash, or in && || or |, continues on the next line, and so does a line that
 * starts with && || or |. A continued command is one line here, so `psql ... ||` and the `true` on the next line are one
 * fallback, and `psql ... |` and the `cat` after it are one pipe.
 */
function logicalLines(text: string[]): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const raw of text) {
    const line = raw.trim();
    if (current !== null && (/(?:\\|&&|\|\||\|)$/.test(current) || /^(?:&&|\|\||\|)/.test(line))) {
      current = `${current.replace(/\\$/, '').trimEnd()} ${line}`;
    } else {
      if (current !== null) out.push(current);
      current = line;
    }
  }
  if (current !== null) out.push(current);
  return out;
}

/** A psql call at the start of a command: `psql ...`, `$(psql ...)`, or after a separator. */
function isPsqlCommand(line: string): boolean {
  return /^\s*(?:(?:\$\(|[;&|(])\s*)?psql\b/.test(line);
}

/** The suites a line names by a literal path. */
function suiteNames(line: string): string[] {
  return [...line.matchAll(SUITE_PATH)].map((match) => match[1]!);
}

/** The domain loop's names: the words between `for s in \` and `; do`. Throws when there is no loop. */
function domainLoop(text: string[]): string[] {
  const match = /for s in \\\n([\s\S]*?); do/.exec(text.join('\n'));
  if (!match) throw new Error('the domain suite loop (`for s in \\ ... ; do`) was not found in the database job');
  const names = match[1]!.replace(/\\/g, ' ').split(/\s+/).filter((word) => word.length > 0);
  if (names.length === 0) throw new Error('the domain suite loop names no suite');
  return names;
}

/**
 * The SQL as psql reads it, with comments blanked (line breaks kept), so that a backslash command is found where psql
 * would run it. With blankStrings, string literals, quoted names and dollar-quoted bodies are blanked too. Without it
 * they are kept, because psql reads a meta-command's arguments with quotes, as in \set 'ON_ERROR_STOP' off.
 */
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

function sqlCode(sql: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const c = sql.charAt(i);
    let end = -1;
    let comment = false;
    if (c === '-' && sql.charAt(i + 1) === '-') {
      const newline = sql.indexOf('\n', i);
      end = newline < 0 ? sql.length : newline;
      comment = true;
    } else if (c === '/' && sql.charAt(i + 1) === '*') {
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else {
          j++;
        }
      }
      end = Math.min(j, sql.length);
      comment = true;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql.charAt(j) === c) {
          if (sql.charAt(j + 1) === c) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      end = Math.min(j, sql.length);
    } else if (c === '$' && !/[A-Za-z0-9_$]/.test(sql.charAt(i - 1))) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql);
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        end = close < 0 ? sql.length : close + tag[0].length;
      }
    }
    if (end < 0) {
      out += c;
      i++;
    } else {
      const span = sql.slice(i, end);
      out += comment || blankStrings ? blank(span) : span;
      i = end;
    }
  }
  return out;
}

/** The fixtures a suite includes by a bare `\i name.sql` or `\ir name.sql` that psql would run, not one in a comment. */
function includedFixtures(sql: string): string[] {
  return sqlCode(sql, true).split('\n').flatMap((line) => {
    const match = /\\(?:ir?|include(?:_relative)?)\s+([A-Za-z0-9_]+)\.sql\s*$/.exec(line);
    return match ? [match[1]!] : [];
  });
}

interface Wiring {
  /** Files CI never runs: not in the loop, not a psql path, and not included by a wired suite. */
  unwired: string[];
  /** Names CI runs, or includes, that have no file behind them. */
  dangling: string[];
}

/** Which of `files` (name without .sql, to SQL text) the database job runs. */
function wiring(workflow: string, files: Map<string, string>): Wiring {
  const text = runText(jobLines(codeLines(workflow), 'database'));
  const named = [...domainLoop(text), ...logicalLines(text).filter(isPsqlCommand).flatMap(suiteNames)];
  const dangling = new Set(named.filter((name) => !files.has(name)));
  const wired = new Set<string>();
  const queue = named.filter((name) => files.has(name));
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (wired.has(name)) continue;
    wired.add(name);
    for (const fixture of includedFixtures(files.get(name)!)) {
      if (files.has(fixture)) queue.push(fixture);
      else dangling.add(fixture);
    }
  }
  return {
    unwired: [...files.keys()].filter((name) => !wired.has(name)).sort(),
    dangling: [...dangling].sort(),
  };
}

/** Shell that can end a command early, or make a failure a success, wherever it starts a command. */
const SHELL_ESCAPE =
  /(?:^|[;&|({]|\$\()\s*(?:continue|eval|source|xargs|nohup|exec|trap|alias|function|if|while|until|case|select|coproc|hash|enable|(?:export|declare|typeset)\s+-f|set\s+\+[eo]|(?:bash|sh)\s+-c|\.|!|:)(?=\s|$|;|\)|\})/;
/** An exit that is not a single failure code 1-9 (exit 0, bare exit, exit 256). */
const EXIT_ESCAPE = /(?:^|[;&|({]|\$\()\s*exit(?!\s+[1-9](?!\d))(?=\s|$|;|\)|\})/;
/** A `||` whose fallback is not an assertion that fails: `|| { ...; exit N; }` or `|| exit N`. */
const OR_ESCAPE = /\|\|\s+(?!\{[^}]*\bexit\s+[1-9](?!\d)[^}]*\}|exit\s+[1-9](?!\d))/;
/** A shell function, which could shadow psql in the same step: a name with empty parentheses, whatever its body. */
const FUNCTION_DEF = /[A-Za-z_][\w-]*\s*\(\s*\)/;

/**
 * The shell text of a line, with quoted text blanked: single quotes, double quotes and what is inside them, including a
 * command substitution written inside double quotes, which is shell again and so is read as shell. A backslash escapes
 * the next character outside single quotes. Command substitutions and backticks outside quotes are read.
 */
function unquoted(line: string): string {
  let out = '';
  const stack: Array<{kind: 'command' | 'sub' | 'tick' | 'single' | 'double' | 'ansi'; depth: number}> = [{kind: 'command', depth: 0}];
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    const top = stack[stack.length - 1]!;
    if (top.kind === 'ansi') {
      out += ' ';
      if (c === '\\') {
        out += ' ';
        i++;
      } else if (c === "'") {
        stack.pop();
      }
    } else if (top.kind === 'single') {
      out += ' ';
      if (c === "'") stack.pop();
    } else if (top.kind === 'double') {
      if (c === '\\') {
        out += '  ';
        i++;
      } else if (c === '"') {
        out += ' ';
        stack.pop();
      } else if (c === '$' && line.charAt(i + 1) === '(') {
        out += '  ';
        i++;
        stack.push({kind: 'sub', depth: 0});
      } else if (c === '`') {
        out += ' ';
        stack.push({kind: 'tick', depth: 0});
      } else {
        out += ' ';
      }
    } else if (c === '\\') {
      out += c + line.charAt(i + 1);
      i++;
    } else if (c === "'") {
      out += ' ';
      stack.push({kind: 'single', depth: 0});
    } else if (c === '"') {
      out += ' ';
      stack.push({kind: 'double', depth: 0});
    } else if (c === '$' && line.charAt(i + 1) === "'") {
      out += '  ';
      i++;
      stack.push({kind: 'ansi', depth: 0});
    } else if (c === '$' && line.charAt(i + 1) === '(') {
      out += '$(';
      i++;
      stack.push({kind: 'sub', depth: 0});
    } else if (c === '`') {
      out += ' ';
      if (top.kind === 'tick') stack.pop();
      else stack.push({kind: 'tick', depth: 0});
    } else if (c === '(' && top.kind === 'sub') {
      top.depth++;
      out += c;
    } else if (c === ')' && top.kind === 'sub') {
      if (top.depth === 0) stack.pop();
      else top.depth--;
      out += c;
    } else {
      out += c;
    }
  }
  return out;
}

/** A pipe that is not part of `||` and not inside a SQL string. */
const PIPE = /(?<![|'"])\|(?!\|)/;
/** A background job: `&` that is not part of `&&` or a redirection like `2>&1`. */
const BACKGROUND = /(?<![&>])&(?![&>])/;

const ALLOWED_ACTIONS = new Set(['actions/checkout', 'actions/setup-node']);

/**
 * The text inside each $( ... ) and backtick pair of a line, and the line with each pair replaced by X. Each inside is read
 * as shell of its own. Single quotes are literal; double quotes still allow a substitution.
 */
function substitutions(line: string): {outer: string; inner: string[]; open: boolean} {
  const inner: string[] = [];
  let outer = '';
  let quote = '';
  let open = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote === "'") {
      outer += c;
      if (c === "'") quote = '';
    } else if (c === '\\') {
      outer += c + line.charAt(i + 1);
      i++;
    } else if (c === "'" && quote === '') {
      quote = "'";
      outer += c;
    } else if (c === '"') {
      quote = quote === '"' ? '' : '"';
      outer += c;
    } else if (c === '$' && line.charAt(i + 1) === '(') {
      const close = matchingParen(line, i + 1);
      if (close >= line.length) open = true;
      inner.push(line.slice(i + 2, close));
      outer += 'X';
      i = close;
    } else if (c === '`') {
      const close = line.indexOf('`', i + 1);
      if (close < 0) open = true;
      const stop = close < 0 ? line.length : close;
      inner.push(line.slice(i + 1, stop));
      outer += 'X';
      i = stop;
    } else {
      outer += c;
    }
  }
  return {outer, inner, open: open || quote !== ''};
}

/** The index of the ) that closes the ( at index open, reading quotes; the line's end when there is none. */
function matchingParen(line: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote === "'") {
      if (c === "'") quote = '';
    } else if (c === '\\') {
      i++;
    } else if (quote === '"') {
      if (c === '"') quote = '';
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return line.length;
}

/**
 * The simple commands of a shell line, each as its words with their quotes. A command ends at ; & | ( ) { } and at the
 * end of a substitution, which is read as commands of its own. A backslash escapes the next character outside quotes.
 */
function simpleCommands(line: string): string[][] {
  const {outer, inner} = substitutions(line);
  const commands: string[][] = inner.flatMap((text) => simpleCommands(text));
  let words: string[] = [];
  let word = '';
  let quote = '';
  const endWord = () => {
    if (word !== '') {
      words.push(word);
      word = '';
    }
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < outer.length; i++) {
    const c = outer.charAt(i);
    if (quote === "'") {
      word += c;
      if (c === "'") quote = '';
    } else if (quote === '"') {
      word += c;
      if (c === '\\') {
        word += outer.charAt(i + 1);
        i++;
      } else if (c === '"') {
        quote = '';
      }
    } else if (c === '\\') {
      word += c + outer.charAt(i + 1);
      i++;
    } else if (c === "'" || c === '"') {
      quote = c;
      word += c;
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if (';&|(){}'.includes(c) && !(words[0] === '[[' && !words.includes(']]') && word !== ']]')) {
      endCommand();
    } else {
      word += c;
    }
  }
  endCommand();
  return commands;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;

/** The command word of a simple command (after any NAME=value words) and the words after it. */
function commandParts(words: string[]): {name: string | undefined; args: string[]} {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) i++;
  return {name: words[i], args: words.slice(i + 1)};
}

/**
 * The reason a command may not run in the database job, or null when it may. The allowed commands are the ones the job
 * uses: psql, node and npx (the integration scripts), echo, createdb, the [[ test, the loop words, export of plain names,
 * set -euo pipefail, exit 1 to 9 (an assertion) and docker inspect. Anything else, such as set +e, shopt, command,
 * builtin, eval, cd, a shell or a wrapper, is refused, so that no builtin changes how a failure propagates.
 */
function commandProblem(name: string, args: string[]): string | null {
  switch (name) {
    case 'psql':
    case 'node':
    case 'npx':
    case 'echo':
    case 'createdb':
    case '[[':
    case 'do':
    case 'done':
      return null;
    case 'export':
      return args.some((a) => a.startsWith('-')) ? 'export with an option is not allowed (export -f defines a shell function)' : null;
    case 'set':
      return args.join(' ') === '-euo pipefail' ? null : 'set in the database job may only be set -euo pipefail';
    case 'exit':
      return args.length === 1 && /^[1-9]$/.test(args[0] ?? '')
        ? null
        : `a command the guard does not allow in the database job: exit ${args.join(' ')} (only exit 1 to 9)`;
    case 'docker':
      return args[0] === 'inspect' ? null : 'docker in the database job may only be docker inspect';
    case 'npm':
      return args.join(' ') === 'ci' ? null : 'npm in the database job may only be npm ci';
    default:
      return `a command the guard does not allow in the database job: ${name}`;
  }
}

const SUITE_OR_RUNNER_FILE = /^["']?supabase\/tests\/(?:[A-Za-z0-9_]+|\$\{s\})\.sql["']?$/;
const LUMIN_SETTINGS = /^(?:set lumin\.[a-z_]+='[^']*';\s*)+$/;

/**
 * The reason a psql call that runs a suite is not in its plain form, or null when it is. The plain form is -X, -v
 * ON_ERROR_STOP=1 (or on, true, yes), -d with a plain database name, exactly one -f suite (or the domain runner's path),
 * and -c only for lumin.* settings that the suites read. Other options change what runs (-c before -f, -l, -V, --, -F,
 * -o, a connection string in -d), so they are refused.
 */
function psqlSuiteProblem(args: string[]): string | null {
  let files = 0;
  let onErrorStop = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const value = args[i + 1];
    if (a === '-X') continue;
    if (a === '-v' && value !== undefined && value.startsWith('ON_ERROR_STOP=') && /^(?:1|on|true|yes)$/i.test(value.slice('ON_ERROR_STOP='.length))) {
      onErrorStop++;
      i++;
      continue;
    }
    if (a === '-d' && value !== undefined && /^[A-Za-z0-9_]+$/.test(value)) {
      i++;
      continue;
    }
    if (a === '-f' && value !== undefined && SUITE_OR_RUNNER_FILE.test(value)) {
      files++;
      i++;
      continue;
    }
    if (a === '-c' && value !== undefined && LUMIN_SETTINGS.test(value.replace(/^"(.*)"$/s, '$1'))) {
      i++;
      continue;
    }
    return `a psql call that runs a suite may only be -X, -v ON_ERROR_STOP=1, -d name, one -f suite and lumin settings with -c; it has ${JSON.stringify(a)}`;
  }
  if (onErrorStop !== 1) return 'a psql call that runs a suite must set -v ON_ERROR_STOP=1 once';
  return files === 1 ? null : 'a psql call that runs a suite must read exactly one suite with -f';
}

/** A line of a suite that psql would read as a shell command, a backtick, or a backslash command other than \set, \echo and an include. */
function sqlBlankedBreaks(sql: string): boolean {
  return sqlCode(sql, true)
    .split('\n')
    .some((line) => line.includes('`') || /\\(?!(?:set|echo|qecho|ir|i)(?![A-Za-z0-9_]))/.test(line));
}

/** Rules that keep every suite run, and its failure fatal, read from the text. Returns the rules that do not hold. */
function policyProblems(workflow: string): string[] {
  const lines = codeLines(workflow);
  const problems: string[] = [];

  const jobsAt = lines.findIndex((line) => line === 'jobs:');
  const triggers = jobsAt < 0 ? lines : lines.slice(0, jobsAt);
  const filterKey = (keys: string) => new RegExp(`(?:^|[\\s{,\\-])["']?(?:${keys})["']?\\s*:`);
  if (triggers.some((line) => filterKey('paths|paths-ignore').test(line))) {
    problems.push('a path filter on the triggers would skip the suites on some changes');
  }
  // The pull_request trigger is the gate: a branch or tag filter there would skip the suites on some pull requests.
  // A filter on push (the run after merge to main) is a choice of when to run, and is allowed.
  const pr = triggers.findIndex((line) => /^\s*["']?pull_request["']?\s*:/.test(line));
  if (pr >= 0) {
    const indent = indentOf(triggers[pr]!);
    const after = triggers.slice(pr + 1);
    const end = after.findIndex((line) => line.trim() !== '' && indentOf(line) <= indent);
    const block = [triggers[pr]!, ...(end < 0 ? after : after.slice(0, end))];
    if (block.some((line) => filterKey('branches|branches-ignore|tags|tags-ignore').test(line))) {
      problems.push('a branch or tag filter on the pull_request trigger would skip the suites on some pull requests');
    }
    if (block.some((line) => /(?:^|[\s{,\-])["']?types["']?\s*:/.test(line))) {
      problems.push('a types filter on the pull_request trigger would skip the suites on some pull request events');
    }
  }
  if (!triggers.some((line) => /pull_request/.test(line))) {
    problems.push('the workflow must run on pull_request, or a failing suite would not fail the pull request');
  }
  if (triggers.some((line) => /pull_request/.test(line) && /(?:^|[\s{,\-])["']?types["']?\s*:/.test(line))) {
    problems.push('a types filter on the pull_request trigger would skip the suites on some pull request events');
  }
  // The flow spelling, `on: { pull_request: {...} }`, on one line: a branch or tag filter on that line is refused too.
  if (triggers.some((line) => /pull_request/.test(line) && filterKey('branches|branches-ignore|tags|tags-ignore').test(line))) {
    problems.push('a branch or tag filter on the pull_request trigger would skip the suites on some pull requests');
  }
  if (lines.some((line) => /(?:^|[\s:])[&*][A-Za-z]/.test(line))) {
    problems.push('a YAML anchor or alias can hide a suite path from a reader of the file');
  }
  if (lines.some((line) => /(?:^|[\s{,\-])["']?defaults["']?\s*:/.test(line))) {
    problems.push('a defaults block can change the shell of every run step, and with it how a failure is handled');
  }
  if (
    lines.some((line) => /\b(?:PSQLRC|BASH_ENV|ENV|PGOPTIONS|PGSERVICEFILE|PGSYSCONFDIR|PATH|HOME|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|SHELLOPTS|BASHOPTS|PGSERVICE|PGHOSTADDR|PGPASSFILE|DATABASE_URL)\b\s*[:=]/.test(line)) ||
    lines.some((line) => /GITHUB_PATH|BASH_FUNC|psqlrc/i.test(line))
  ) {
    problems.push(
      'an environment variable, file or shell setting that changes psql or the shell (PSQLRC, psqlrc, BASH_ENV, PATH, HOME, GITHUB_PATH, BASH_FUNC_, LD_PRELOAD, SHELLOPTS, PGOPTIONS, ...) can override ON_ERROR_STOP or the exit status',
    );
  }
  if (lines.some((line) => /^\s*(?:-\s+)?run:\s*>/.test(line))) {
    problems.push(
      'a folded (>) run block joins its lines into one command in YAML, so the guard and bash would read different commands; write a run step as a literal block (|) or on one line',
    );
  }
  const loops = lines.filter((line) => /\bfor\s+s\s+in\b/.test(line)).length;
  if (loops !== 1) problems.push(`the workflow must have exactly one domain loop, and it has ${loops}`);

  const job = jobLines(lines, 'database');
  // The only loops the database job may run: the domain loop, the migration loop, and the check that no routing
  // override is set. Any other loop could run suites outside the domain loop, or skip them.
  const allowedLoops = new Set([
    'for s in \\',
    'for f in supabase/migrations/0*.sql; do',
    'for override in PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS DATABASE_URL; do',
  ]);
  // A loop that starts a command, of any form (`for s in`, `for x; do`, `for ((...))`), other than the three above.
  const otherLoops = runText(job).filter(
    (line) => /(?:^|[;&|({]|\$\(|\b(?:then|do|else)\b)\s*for\b/.test(line) && !allowedLoops.has(line),
  );
  if (otherLoops.length > 0) {
    problems.push(
      `a loop other than the domain loop, the migration loop and the routing-override check can run suites outside the domain loop: ${JSON.stringify(otherLoops)}`,
    );
  }
  if (job.some((line) => /(?:^|[\s{,\-])["']?if["']?\s*:/.test(line))) {
    problems.push('a condition on the database job or one of its steps can skip suites');
  }
  if (job.some((line) => line.includes('continue-on-error'))) {
    problems.push('continue-on-error in the database job lets a failing suite pass');
  }
  if (job.some((line) => /(?:^|[\s{,\-])["']?shell["']?\s*:/.test(line))) {
    problems.push('a custom shell in the database job can change how a failing command is handled');
  }

  if (job.some((line) => /(?:^|[\s{,\-])["']?container["']?\s*:/.test(line))) {
    problems.push('a container image for the database job changes the psql and the shell its suites run in');
  }
  if (job.some((line) => /(?:^|[\s{,\-])["']?uses["']?\s*:\s*["']?(?:\.\/|\S*\.github\/workflows\/)/.test(line))) {
    problems.push('a local action or reusable workflow in the database job runs code this guard does not read');
  }
  if (job.some((line) => /\$\{\{/.test(line.replace(/\$\{\{\s*job\.services\.postgres\.id\s*\}\}/g, '')))) {
    problems.push(
      'a GitHub expression in the database job is evaluated before bash reads the step, so the guard cannot read what runs; only the postgres service id may be used',
    );
  }
  if (job.some((line) => /^\s*runs-on:/.test(line) && !/^\s*runs-on:\s*["']?ubuntu-/.test(line))) {
    problems.push('the database job must run on an ubuntu runner, where a run step is bash -e and psql is the one the guard reads');
  }
  const actions = job.flatMap((line) => {
    const match = /(?:^|[\s{,\-])["']?uses["']?\s*:\s*["']?([^\s"'@#]+)/.exec(line);
    return match ? [match[1]!] : [];
  });
  if (actions.some((action) => !ALLOWED_ACTIONS.has(action))) {
    problems.push(
      `an action the guard does not read runs code in the database job; only actions/checkout and actions/setup-node are allowed: ${JSON.stringify(actions)}`,
    );
  }
  if (job.some((line) => /^\s*image:/.test(line) && !/^\s*image:\s*["']?postgres:16["']?\s*$/.test(line))) {
    problems.push(
      'the database service must be postgres:16, the server the suites are checked against; another image could pass them',
    );
  }
  const shellText = runText(job);
  if (shellText.some((line) => line.includes('<<'))) {
    problems.push(
      'a here-document in the database job feeds a child shell, which does not run with bash -e, so a suite in it could fail without failing the job',
    );
  }
  if (shellText.some((line) => line.includes('`'))) {
    problems.push('a backtick in the database job is a command substitution the guard does not read; write $(...) instead');
  }
  if (shellText.some((line) => /\$'/.test(line))) {
    problems.push("ANSI-C quoting ($'...') in the database job has escapes the guard does not read");
  }
  if (shellText.some((line) => /check_asserts|alter\s+(?:database|system|role)\b/i.test(line))) {
    problems.push(
      'check_asserts turns off ASSERT, and ALTER DATABASE, ALTER ROLE or ALTER SYSTEM changes settings for every later session; neither may appear in the database job',
    );
  }
  const text = runText(job);
  for (const line of logicalLines(text)) {
    if (/supabase\/tests\b/.test(line) && !isPsqlCommand(line)) {
      problems.push(`a line that names a suite path must run psql itself, or the suite may not run: ${line}`);
    }
    if (/\/\S*\bpsql\b|\b(?:cp|mv|ln|install|tee)\b[^;&|]*\bpsql\b|>\s*\S*\bpsql\b/.test(line)) {
      problems.push(`a path to psql, or a write over it, can replace the psql that runs the suites: ${line}`);
    }
    if (line !== RUNNER && (line.match(/supabase\/tests\//g) ?? []).length !== suiteNames(line).length) {
      problems.push(`a path under supabase/tests that is not a plain name.sql can be run, and the guard does not read it: ${line}`);
    }
    if (/\bpsql\b/.test(line) && /\\[A-Za-z!]/.test(line.replace(/\\ir?\s+["']?supabase\/tests\/[A-Za-z0-9_]+\.sql["']?/g, ''))) {
      problems.push(
        `a psql backslash command other than an include of a suite can stop the session or change ON_ERROR_STOP, and a -c command runs before a later -f: ${line}`,
      );
    }
    if (/(?:^|[\s;&|({])(?:cd|pushd|popd|git|tee|cp|mv|ln|install|patch|truncate|dd|rsync)(?=[\s;&|)}]|$)|(?:^|[\s;&|({])(?:sed|perl)\s+-i\b/.test(line)) {
      problems.push(`a command that changes directory or writes files can change which suite psql reads: ${line}`);
    }
    if (/>{1,2}(?!&\d)\s*(?!\/dev\/null\b)\S/.test(line)) {
      problems.push(`a redirection to a file can overwrite a suite or a fixture the database job reads: ${line}`);
    }
    if (substitutions(line).open) {
      problems.push(
        `a command substitution or a quotation that is not closed on its line lets bash read the next line as part of it, and the guard does not join those lines: ${line}`,
      );
    }
    if (/supabase\/tests/.test(line) && /&&/.test(line)) {
      problems.push(
        `a line that names a suite may not be part of an && list, since a failing command before && does not end the step under bash -e: ${line}`,
      );
    }
    const loopHeader = /^for s in [A-Za-z0-9_ ]*; do$/.test(line) || allowedLoops.has(line);
    if (!loopHeader) {
      for (const words of simpleCommands(line)) {
        const {name, args} = commandParts(words);
        if (name === undefined) continue;
        const problem = commandProblem(name, args);
        if (problem !== null) problems.push(`${problem}: ${line}`);
        if (name !== 'psql' && /supabase\/tests\//.test(words.join(' '))) {
          problems.push(`a suite path may appear only as the -f file of a psql call that runs it; this command names one: ${line}`);
        }
        if (name === 'psql' && /supabase\/tests/.test(words.join(' '))) {
          const suiteProblem = psqlSuiteProblem(args);
          if (suiteProblem !== null) problems.push(`${suiteProblem}: ${line}`);
        }
      }
    }
    if (SHELL_ESCAPE.test(line) || EXIT_ESCAPE.test(line)) {
      problems.push(
        `a shell escape (continue, exit that is not a failure, set +e, negation, eval, source, if, ...) lets a failing suite pass: ${line}`,
      );
    }
    if (OR_ESCAPE.test(line)) {
      problems.push(`a || fallback that does not fail lets a failing suite pass: ${line}`);
    }
    if (FUNCTION_DEF.test(unquoted(line))) {
      problems.push(`a shell function can shadow psql and hide its failure: ${line}`);
    }
    if (PIPE.test(line) && /\bpsql\b/.test(line)) {
      problems.push(`a psql call piped to another command, or run in the background, hides its exit status: ${line}`);
    }
    if (BACKGROUND.test(line) && /\bpsql\b/.test(line)) {
      problems.push(`a psql call piped to another command, or run in the background, hides its exit status: ${line}`);
    }
    if (/\bpsql\b/.test(line)) {
      const runsFile = /(?:^|\s)-f|--file|\\i|<\s*\S/.test(line);
      const assignments = [...line.matchAll(/ON_ERROR_STOP=([^\s"']*)/gi)].map((match) => match[1]!);
      if (runsFile && assignments.length === 0) {
        problems.push(`a psql call that runs a suite lacks -v ON_ERROR_STOP=1, so a failing statement passes: ${line}`);
      }
      if (assignments.some((value) => !/^(?:1|on|true|yes)$/i.test(value))) {
        problems.push(`a psql call that sets ON_ERROR_STOP to off, or to a value that is not on, lets a failure pass: ${line}`);
      }
    }
  }

  const start = text.findIndex((line) => /^for s in \\$/.test(line));
  const open = start < 0 ? -1 : text.findIndex((line, i) => i > start && /; do$/.test(line));
  const close = open < 0 ? -1 : text.findIndex((line, i) => i > open && line === 'done');
  if (open < 0 || close < 0) {
    problems.push('the domain loop has no body that ends in done');
  } else {
    const body = text.slice(open + 1, close);
    const others = body.filter((line) => line !== RUNNER && line !== RUNNER_ECHO);
    const runners = body.filter((line) => line === RUNNER).length;
    if (runners !== 1 || others.length > 0) {
      problems.push(
        `the domain loop body must run exactly one psql call and nothing else; it has ${runners} psql call(s) and these other lines: ${JSON.stringify(others)}`,
      );
    }
  }
  return problems;
}

/**
 * SQL that psql reads as a command which can end the run early, switch ON_ERROR_STOP off, run a shell, set variables
 * from a query, write a file, or include a file by any name but a bare name.sql. Comments are not read. String literals,
 * quoted names and dollar-quoted bodies are read too, so a string that names one of these is refused. A \set of
 * ON_ERROR_STOP is allowed only as `\set ON_ERROR_STOP on|1|true|yes` on a line of its own. check_asserts turns off ASSERT,
 * and ALTER DATABASE, ALTER ROLE or ALTER SYSTEM changes settings for every later session, so neither may appear.
 */
function sqlProblems(files: Map<string, string>): string[] {
  return [...files.entries()]
    .filter(([, sql]) => {
      const code = sqlCode(sql, false).split('\n');
      const raw = sql.split('\n');
      return (
        code.some((line, i) => sqlCommandBreaks(line, raw[i] ?? '')) ||
        sqlBlankedBreaks(sql) ||
        /check_asserts|alter\s+(?:database|system|role)\b/i.test(code.join('\n'))
      );
    })
    .map(([name]) => name)
    .sort();
}

/** Whether one line of code (see sqlCode), with its raw text, holds a command that sqlProblems refuses. */
function sqlCommandBreaks(line: string, raw: string): boolean {
  if (/\\(?:q|quit|gset|prompt)(?![A-Za-z0-9_])/.test(line)) return true;
  if (/\\!/.test(line)) return true;
  if (/\\unset\s+['"]?ON_ERROR_STOP['"]?(?![A-Za-z0-9_])/i.test(line)) return true;
  if (
    /\\set\s+['"]?ON_ERROR_STOP['"]?(?![A-Za-z0-9_])/i.test(line) &&
    !/^\s*\\set\s+ON_ERROR_STOP\s+(?:on|1|true|yes)\s*$/i.test(raw)
  ) {
    return true;
  }
  const include = /\\(?:ir?|include(?:_relative)?)(?![A-Za-z0-9_])(.*)$/.exec(line);
  return include !== null && !/^\s+[A-Za-z0-9_]+\.sql\s*$/.test(include[1]!);
}

/**
 * A stand-in for psql, for the CI guard. It exits the way psql does for the forms CI uses: it fails with status 3
 * only for the suite named in STUB_FAIL_ON, and only when ON_ERROR_STOP is on; the last ON_ERROR_STOP assignment
 * wins. The suite is taken from -f, --file=, a \i or \ir in -c, or the standard input. Every other call succeeds.
 */
const PSQL_STUB = [
  '#!/usr/bin/env bash',
  'on_value() { case "$(printf \'%s\' "$1" | tr \'[:upper:]\' \'[:lower:]\')" in 1|on|true|yes) echo 1 ;; *) echo 0 ;; esac; }',
  'stop=0; file=""; cmd=""; want=""; name=""',
  'for arg in "$@"; do',
  '  if [ -n "$want" ]; then',
  '    case "$want" in',
  '      cmd) cmd="$arg" ;;',
  '      file) file="$arg" ;;',
  '      set) case "$arg" in ON_ERROR_STOP=*) stop=$(on_value "${arg#ON_ERROR_STOP=}") ;; esac ;;',
  '    esac',
  '    want=""',
  '    continue',
  '  fi',
  '  case "$arg" in',
  '    -v) want=set ;;',
  '    -v*) case "${arg#-v}" in ON_ERROR_STOP=*) stop=$(on_value "${arg#-vON_ERROR_STOP=}") ;; esac ;;',
  '    --set=*) case "${arg#--set=}" in ON_ERROR_STOP=*) stop=$(on_value "${arg#--set=ON_ERROR_STOP=}") ;; esac ;;',
  '    -f) want=file ;;',
  '    -f*) file="${arg#-f}" ;;',
  '    --file=*) file="${arg#--file=}" ;;',
  '    --file) want=file ;;',
  '    -c) want=cmd ;;',
  '    -[A-Za-z]*c) want=cmd ;;',
  '    --command=*) cmd="${arg#--command=}" ;;',
  '  esac',
  'done',
  'if [ -n "$file" ]; then',
  '  name="$(basename "$file")"; name="${name%.sql}"',
  'elif [[ "$cmd" =~ \\\\i(r)?[[:space:]]+([^[:space:];]+) ]]; then',
  '  name="$(basename "${BASH_REMATCH[2]}")"; name="${name%.sql}"',
  'elif [ -z "$cmd" ] && [ -n "$STUB_FAIL_ON" ]; then',
  '  content="$(cat)"',
  '  if [ "$content" = "$(cat "supabase/tests/$STUB_FAIL_ON.sql" 2>/dev/null)" ]; then name="$STUB_FAIL_ON"; fi',
  'fi',
  'if [ -n "$STUB_FAIL_ON" ] && [ "$name" = "$STUB_FAIL_ON" ] && [ "$stop" = 1 ]; then',
  '  echo "psql: stand-in failure in $name" >&2',
  '  exit 3',
  'fi',
  'exit 0',
  '',
].join('\n');

let stubDir: string | undefined;

function stub(): string {
  if (!stubDir) {
    stubDir = mkdtempSync(join(tmpdir(), 'ci-guard-psql-'));
    const path = join(stubDir, 'psql');
    writeFileSync(path, PSQL_STUB);
    chmodSync(path, 0o755);
  }
  return stubDir;
}

afterAll(() => {
  if (stubDir) rmSync(stubDir, {recursive: true, force: true});
});

/**
 * Runs a snippet the way CI runs a run step (bash -e), with the psql stand-in first on PATH and standard input
 * closed. Resolves to the exit status, or null when the snippet could not finish.
 */
function runSnippet(snippet: string, failing?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-e', '-c', snippet], {
      cwd: ROOT,
      env: {...process.env, PATH: `${stub()}${delimiter}${process.env.PATH ?? ''}`, STUB_FAIL_ON: failing ?? ''},
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Runs the checks sixteen at a time, and returns their statuses in order. */
async function runAll(checks: Array<{snippet: string; failing?: string}>): Promise<Array<number | null>> {
  const statuses: Array<number | null> = [];
  for (let i = 0; i < checks.length; i += 16) {
    const batch = checks.slice(i, i + 16);
    statuses.push(...(await Promise.all(batch.map((check) => runSnippet(check.snippet, check.failing)))));
  }
  return statuses;
}

/**
 * Behaviour: with every suite passing, the domain loop and each psql line that runs a suite succeed; with a suite
 * failing, the loop and the line that runs that suite fail. Returns what does not hold.
 */
async function behaviourProblems(workflow: string): Promise<string[]> {
  const text = runText(jobLines(codeLines(workflow), 'database'));
  const names = domainLoop(text);
  const start = text.findIndex((line) => /^for s in \\$/.test(line));
  const end = text.findIndex((line, i) => i > start && line === 'done');
  if (start < 0 || end < 0) throw new Error('the domain loop was not found in the database job');
  const loop = text.slice(start, end + 1).join('\n');

  // Each check says what must happen: `mustFail` checks must not succeed; the others must succeed.
  const checks: Array<{label: string; snippet: string; failing?: string; mustFail: boolean}> = [
    {label: 'the domain loop does not pass when every suite passes', snippet: loop, mustFail: false},
    ...names.map((name) => ({label: `the domain loop passes when ${name} fails`, snippet: loop, failing: name, mustFail: true})),
  ];
  for (const line of logicalLines(text)) {
    const [suite] = suiteNames(line);
    if (!suite || !/\bpsql\b/.test(line)) continue;
    checks.push({label: `the psql line for ${suite} does not pass when every suite passes: ${line}`, snippet: line, mustFail: false});
    checks.push({label: `the psql line for ${suite} passes when ${suite} fails: ${line}`, snippet: line, failing: suite, mustFail: true});
  }
  const statuses = await runAll(checks);
  return checks.flatMap((check, i) => {
    const status = statuses[i];
    const holds = check.mustFail ? status !== 0 : status === 0;
    return holds ? [] : [check.label];
  });
}

/** Every top-level SQL file, and every subdirectory (which this guard does not read). */
function sqlFiles(): {files: Map<string, string>; directories: string[]} {
  const files = new Map<string, string>();
  const directories: string[] = [];
  for (const entry of readdirSync(SUITES, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      directories.push(entry.name);
      continue;
    }
    if (!entry.name.endsWith('.sql')) continue;
    files.set(entry.name.slice(0, -'.sql'.length), readFileSync(new URL(entry.name, SUITES), 'utf8'));
  }
  return {files, directories};
}

function fileMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

/** Triggers for a workflow in tests: the pull_request gate, as the real workflow has it. */
const PR_TRIGGERS = ['on:', '  pull_request:'];

/** A minimal workflow as lines: optional trigger lines, a database job with one domain loop, then step lines. */
function workflowLines(loop: string[], steps: string[] = [], triggers: string[] = PR_TRIGGERS): string[] {
  const list = loop.map((name, i) => `            ${name}${i === loop.length - 1 ? '; do' : ' \\'}`);
  return [
    ...triggers,
    'jobs:',
    '  database:',
    '    steps:',
    '      - name: Run domain security suites',
    '        run: |',
    '          for s in \\',
    ...list,
    `            ${RUNNER_ECHO}`,
    `            ${RUNNER}`,
    '          done',
    ...steps,
  ];
}

const workflowText = (loop: string[], steps: string[] = [], triggers: string[] = PR_TRIGGERS): string =>
  workflowLines(loop, steps, triggers).join('\n');

describe('every SQL suite under supabase/tests is run by CI, and a failure fails the job', () => {
  it('the repository runs every suite, the job cannot pass a failing suite, and the loop and the suite lines behave', async () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const {files, directories} = sqlFiles();
    expect(domainLoop(runText(jobLines(codeLines(workflow), 'database'))).length, 'the loop was read, not skipped').toBeGreaterThanOrEqual(50);
    expect(files.size, 'the suite directory was read, not skipped').toBeGreaterThanOrEqual(50);
    expect(directories, 'a suite in a subdirectory is outside this guard: move it to supabase/tests').toEqual([]);
    expect(sqlProblems(files), 'SQL files that end psql early or turn ON_ERROR_STOP off').toEqual([]);
    expect(policyProblems(workflow), 'the CI rules that keep every suite run and its failure fatal').toEqual([]);
    const result = wiring(workflow, files);
    expect(result.dangling, 'CI names a suite or fixture that has no file').toEqual([]);
    expect(
      result.unwired,
      'CI never runs these suites: add each to the database job loop, or give it its own psql step',
    ).toEqual([]);
    expect(await behaviourProblems(workflow), 'the run steps do not fail when a suite fails').toEqual([]);
  }, 120000);

  it('a suite that nothing runs is reported', () => {
    expect(wiring(workflowText(['alpha_tests']), fileMap({alpha_tests: '', beta_tests: ''}))).toEqual({
      unwired: ['beta_tests'],
      dangling: [],
    });
  });

  it('a path on a psql step line counts, and a commented path does not', () => {
    const steps = [
      '      - name: Own step',
      '        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql',
      '      # - name: Retired step',
      '      #   run: psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql',
    ];
    expect(
      wiring(workflowText(['alpha_tests'], steps), fileMap({alpha_tests: '', beta_tests: '', gamma_tests: ''})),
    ).toEqual({unwired: ['gamma_tests'], dangling: []});
  });

  it('a trailing shell comment does not hide a path, and a YAML comment without a space is removed too', () => {
    const steps = [
      '        run: |',
      '          psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql # the real suite',
      '          # psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql',
      '        run: echo skipped  #psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql',
    ];
    expect(
      wiring(workflowText(['alpha_tests'], steps), fileMap({alpha_tests: '', beta_tests: '', gamma_tests: ''})),
    ).toEqual({unwired: ['gamma_tests'], dangling: []});
  });

  it('a path on a line that does not run psql is not a run, and a longer file name is not the suite', () => {
    const steps = [
      '        run: echo "retired: supabase/tests/beta_tests.sql"',
      '        run: echo psql supabase/tests/beta_tests.sql',
      '        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql.bak',
    ];
    expect(
      wiring(workflowText(['alpha_tests'], steps), fileMap({alpha_tests: '', beta_tests: '', gamma_tests: ''})),
    ).toEqual({unwired: ['beta_tests', 'gamma_tests'], dangling: []});
  });

  it('a fixture is wired through a wired suite only; a quoted include is not read, so its fixture is unwired', () => {
    const files = fileMap({
      alpha_tests: "\\ir fixture_x.sql\n\\ir 'fixture_q.sql'\nselect 1;",
      fixture_x: 'select 1;',
      fixture_q: 'select 1;',
      delta_tests: '\\ir fixture_y.sql\nselect 1;',
      fixture_y: 'select 1;',
    });
    expect(wiring(workflowText(['alpha_tests']), files)).toEqual({
      unwired: ['delta_tests', 'fixture_q', 'fixture_y'],
      dangling: [],
    });
  });

  it('an include inside a block comment or a dollar quote is not read', () => {
    const files = fileMap({
      alpha_tests: '/*\n\\ir fixture_b.sql\n*/\nselect $q$\n\\ir fixture_c.sql\n$q$;',
      fixture_b: 'select 1;',
      fixture_c: 'select 1;',
    });
    expect(wiring(workflowText(['alpha_tests']), files)).toEqual({unwired: ['fixture_b', 'fixture_c'], dangling: []});
  });

  it('a loop name, a path or an include with no file is dangling', () => {
    const steps = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/also_gone_tests.sql'];
    expect(
      wiring(
        workflowText(['alpha_tests', 'gone_tests'], steps),
        fileMap({alpha_tests: '\\ir missing_fixture.sql\n'}),
      ),
    ).toEqual({unwired: [], dangling: ['also_gone_tests', 'gone_tests', 'missing_fixture']});
  });

  it('a workflow with no database job or no loop fails loudly, and never passes on an empty read', () => {
    expect(() => wiring('jobs:\n  database: {}\n', new Map())).toThrow(/database job|domain suite loop/);
  });

  it('the rules hold for a plain workflow, and the behaviour holds too', async () => {
    expect(policyProblems(workflowText(['alpha_tests']))).toEqual([]);
    expect(await behaviourProblems(workflowText(['alpha_tests']))).toEqual([]);
  });

  it('a condition on the database job, or on one of its steps, is refused, quoted or not', () => {
    const job = workflowLines(['alpha_tests']);
    job.splice(job.indexOf('  database:') + 1, 0, '    if: false');
    expect(policyProblems(job.join('\n')).join('\n')).toMatch(/a condition on the database job/);
    const step = workflowText(['alpha_tests'], ['      - name: Retired', '        if: false', '        run: echo x']);
    expect(policyProblems(step).join('\n')).toMatch(/a condition on the database job/);
    const quoted = workflowText(['alpha_tests'], ['      - {"if": false, run: echo x}']);
    expect(policyProblems(quoted).join('\n')).toMatch(/a condition on the database job/);
  });

  it('continue-on-error in the database job is refused', () => {
    const steps = ['      - name: Lenient', '        continue-on-error: true', '        run: echo x'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/continue-on-error/);
  });

  it('a shell escape at the start of a command is refused, and an assertion that fails is not', () => {
    const escapes = ['exit 0', 'exit', 'set +e', 'set +o errexit', '! psql', 'if psql', ': ', '. ./env.sh', 'eval x'];
    for (const escape of escapes) {
      const steps = [`        run: ${escape}; psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql`];
      expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n'), escape).toMatch(/a shell escape/);
    }
    const assertion = ['        run: test -n "$X" || { echo "missing"; exit 1; }'];
    expect(policyProblems(workflowText(['alpha_tests'], assertion)).join('\n')).not.toMatch(/a shell escape|fallback/);
  });

  it('a || fallback that does not fail is refused, whatever it runs', () => {
    for (const fallback of ['|| true', '|| :', '|| echo failed', '|| /bin/true', '|| { echo failed; }', '|| exit 256']) {
      const steps = [`        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql ${fallback}`];
      expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n'), fallback).toMatch(/fallback that does not fail/);
    }
  });

  it('a psql call that runs a suite without ON_ERROR_STOP, or that turns it off, is refused', () => {
    const steps = ['        run: psql -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/lacks -v ON_ERROR_STOP=1/);
    const off = ['        run: psql -v ON_ERROR_STOP=1 -v ON_ERROR_STOP=0 -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], off)).join('\n')).toMatch(/sets ON_ERROR_STOP to off/);
    const onForm = ['        run: psql -v ON_ERROR_STOP=on -d lumin_test -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], onForm))).toEqual([]);
  });

  it('a psql call piped to another command, or run in the background, is refused', () => {
    const piped = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql | tee run.log'];
    expect(policyProblems(workflowText(['alpha_tests'], piped)).join('\n')).toMatch(/piped to another command/);
    const glued = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql|(cat)'];
    expect(policyProblems(workflowText(['alpha_tests'], glued)).join('\n')).toMatch(/piped to another command/);
    const background = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql &'];
    expect(policyProblems(workflowText(['alpha_tests'], background)).join('\n')).toMatch(/run in the background/);
  });

  it('a pipe inside a SQL string, a redirect, and a logical AND are not refused', () => {
    const steps = [
      '        run: psql -v ON_ERROR_STOP=1 -Atc "select \'a\'||\'|\'||\'b\'" -f supabase/tests/beta_tests.sql 2>&1',
      '        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql && echo ok',
    ];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).not.toMatch(/piped to another|background/);
  });

  it('a shell function in the database job is refused, since it could shadow psql', () => {
    const steps = ['        run: psql() { command psql "$@" || { :; }; }'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/shell function/);
  });

  it('a second domain loop, on one line or on several, is refused', () => {
    const several = ['          for s in \\', '            beta_tests; do', '            echo x', '          done'];
    expect(policyProblems(workflowText(['alpha_tests'], several)).join('\n')).toMatch(/exactly one domain loop/);
    const oneLine = ['        run: for t in supabase/tests/beta_tests.sql; do echo "$t"; done'];
    expect(policyProblems(workflowText(['alpha_tests'], oneLine)).join('\n')).toMatch(/a loop other than the domain loop/);
  });

  it('the domain loop body must be the one runner and its echo, and nothing else', () => {
    const extra = workflowLines(['alpha_tests']);
    extra.splice(extra.indexOf(`            ${RUNNER}`), 0, '            [ "$s" = beta_tests ] && continue');
    expect(policyProblems(extra.join('\n')).join('\n')).toMatch(/must run exactly one psql call/);
    const echoOnly = workflowLines(['alpha_tests'])
      .map((line) => (line === `            ${RUNNER}` ? '            echo "would run $s"' : line))
      .join('\n');
    expect(policyProblems(echoOnly).join('\n')).toMatch(/must run exactly one psql call/);
  });

  it('a shell override, eval, or a defaults block in the database job is refused', () => {
    const custom = ['        shell: bash -e {0}', '        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], custom)).join('\n')).toMatch(/custom shell/);
    const trigger = ['defaults:', '  run:', '    shell: bash --noprofile --norc {0}'];
    expect(policyProblems(workflowText(['alpha_tests'], [], trigger)).join('\n')).toMatch(/defaults block/);
  });

  it('an environment variable that changes psql, or the shell, is refused', () => {
    const steps = ['      - name: Quiet', '        env:', '          PSQLRC: supabase/tests/rc.conf', '        run: echo x'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/environment variable/);
  });

  it('a path, branch or tag filter on the triggers is refused, in any spelling', () => {
    const paths = ['on:', '  pull_request:', '    paths-ignore:', "      - 'supabase/tests/**'"];
    expect(policyProblems(workflowText(['alpha_tests'], [], paths)).join('\n')).toMatch(/a path filter/);
    const flow = ['on: { pull_request: { paths-ignore: [supabase/tests/**] }, push: { branches: [main] } }'];
    expect(policyProblems(workflowText(['alpha_tests'], [], flow)).join('\n')).toMatch(/a path filter|a branch or tag filter/);
    const branches = ['on:', '  pull_request:', '    branches: [release]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], branches)).join('\n')).toMatch(/a branch or tag filter/);
    const inline = ['on: { pull_request: { branches: [release] } }'];
    expect(policyProblems(workflowText(['alpha_tests'], [], inline)).join('\n')).toMatch(/a branch or tag filter/);
    const inlineShared = ['on: { pull_request: {}, push: { branches: [main] } }'];
    expect(policyProblems(workflowText(['alpha_tests'], [], inlineShared)).join('\n')).toMatch(/a branch or tag filter/);
  });

  it('a branch filter on push, the run after merge to main, is allowed; the pull_request trigger is not filtered', () => {
    const repository = ['on:', '  pull_request:', '  push:', '    branches: [main]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], repository))).toEqual([]);
  });

  it('a YAML anchor is refused, at the end of a line or in the middle', () => {
    const steps = ['      x-retired: &retired', '        run: echo x'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/YAML anchor or alias/);
    const middle = ['        run: &cmd echo x'];
    expect(policyProblems(workflowText(['alpha_tests'], middle)).join('\n')).toMatch(/YAML anchor or alias/);
  });

  it('SQL that ends psql early, or turns ON_ERROR_STOP off, is refused; ON_ERROR_STOP on is not', () => {
    expect(
      sqlProblems(
        fileMap({
          on: '\\set ON_ERROR_STOP on\nselect 1;',
          upper: '\\set ON_ERROR_STOP ON\nselect 1;',
          one: '\\set ON_ERROR_STOP 1\nselect 1;',
          quits: 'select 1;\n\\quit\n',
          short: '\\q\n',
          off: '\\set ON_ERROR_STOP off\nselect 1;',
          unset: '\\unset ON_ERROR_STOP\nselect 1;',
          bare: '\\set ON_ERROR_STOP\nselect 1;',
        }),
      ),
    ).toEqual(['bare', 'off', 'quits', 'short', 'unset']);
  });

  it('behaviour: a loop or a psql line that a failing suite does not fail is reported', async () => {
    const lines = workflowLines(['alpha_tests', 'beta_tests'], [
      '        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql || true',
    ]).map((line) => (line === `            ${RUNNER}` ? `            ${RUNNER} || true` : line));
    const found = (await behaviourProblems(lines.join('\n'))).join('\n');
    expect(found).toMatch(/the domain loop passes when alpha_tests fails/);
    expect(found).toMatch(/the psql line for gamma_tests passes when gamma_tests fails/);
  });

  it('behaviour: a psql line that turns ON_ERROR_STOP off, or reads its suite from a long option, is caught', async () => {
    const off = workflowText(['alpha_tests'], ['        run: psql -v ON_ERROR_STOP=1 -v ON_ERROR_STOP=0 -f supabase/tests/beta_tests.sql']);
    expect((await behaviourProblems(off)).join('\n')).toMatch(/the psql line for beta_tests passes when beta_tests fails/);
    const longOption = workflowText(['alpha_tests'], ['        run: psql -d lumin_test --file=supabase/tests/beta_tests.sql']);
    expect((await behaviourProblems(longOption)).join('\n')).toMatch(/beta_tests passes when beta_tests fails/);
    const withErrorStop = workflowText(['alpha_tests'], ['        run: psql -v ON_ERROR_STOP=1 -c "\\i supabase/tests/beta_tests.sql"']);
    expect(await behaviourProblems(withErrorStop)).toEqual([]);
  });

  it('SQL that psql reads as a command which ends the run, switches ON_ERROR_STOP off, runs a shell or sets variables is refused', () => {
    expect(
      sqlProblems(
        fileMap({
          midline_quit: 'select 1; \\q\n',
          quit_word: 'select 1;\n\\quit\n',
          unset: '\\unset ON_ERROR_STOP\nselect 1;',
          quoted_set: '\\set "ON_ERROR_STOP" off\nselect 1;',
          quoted_single: "\\set 'ON_ERROR_STOP' off\n",
          bare_set: '\\set ON_ERROR_STOP\nselect 1;',
          gset: "select 'off' AS ON_ERROR_STOP \\gset\n",
          prompt: '\\prompt "x" ON_ERROR_STOP\n',
          shell: '\\! echo hi\nselect 1;',
          include_quoted: "\\ir 'fixture.sql'\n",
          include_path: '\\i ../other.sql\n',
          include_trailing: '\\i fixture.sql junk\n',
        }),
      ),
    ).toEqual([
      'bare_set',
      'gset',
      'include_path',
      'include_quoted',
      'include_trailing',
      'midline_quit',
      'prompt',
      'quit_word',
      'quoted_set',
      'quoted_single',
      'shell',
      'unset',
    ]);
  });

  it('SQL comments are not read, and bare includes and \\set ON_ERROR_STOP on are not refused', () => {
    expect(
      sqlProblems(
        fileMap({
          comment: '-- \\q and \\set ON_ERROR_STOP off\n/* \\! ls \\unset ON_ERROR_STOP */\nselect 1;\n',
          on: '\\set ON_ERROR_STOP on\n\\set ON_ERROR_STOP true\n',
          echo: '\\qecho done\n',
          bare_include: '\\ir fixture_b.sql\n\\i fixture_c.sql\n',
        }),
      ),
    ).toEqual([]);
  });

  it('a string, a dollar-quoted body or a trailing comment that names a command is read, and refused', () => {
    expect(
      sqlProblems(
        fileMap({
          string: "select '\\q', '\\unset ON_ERROR_STOP', '\\!';\n",
          dollar: 'do $body$ begin perform 1; \\q end $body$;\n',
          trailing: '\\set ON_ERROR_STOP 1 -- set on\n',
        }),
      ),
    ).toEqual(['dollar', 'string', 'trailing']);
  });

  it('a line that ends in && || or |, or a line that starts with one, continues the command before it', () => {
    const fallback = ['        run: |', '          psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql ||', '            true'];
    expect(policyProblems(workflowText(['alpha_tests'], fallback)).join('\n')).toMatch(/fallback that does not fail/);
    const leading = ['        run: |', '          psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql', '            || true'];
    expect(policyProblems(workflowText(['alpha_tests'], leading)).join('\n')).toMatch(/fallback that does not fail/);
    const piped = ['        run: |', '          psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql |', '            cat'];
    expect(policyProblems(workflowText(['alpha_tests'], piped)).join('\n')).toMatch(/piped to another command/);
  });

  it('a pull_request block is read at any indentation, and a branch filter under push is not a filter on pull_request', () => {
    const indented = ['on:', '    pull_request:', '      branches: [release]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], indented)).join('\n')).toMatch(/a branch or tag filter/);
    const push = ['on:', '    pull_request:', '  push:', '    branches: [main]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], push))).toEqual([]);
  });

  it('a loop with no word list, or a C-style loop, is refused like any other loop', () => {
    for (const loop of ['for x; do', 'for ((i = 0; i < 1; i++)); do']) {
      const steps = [`        run: ${loop} psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql; done`];
      expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n'), loop).toMatch(/a loop other than the domain loop/);
    }
  });

  it('a line that names a suite path must run psql itself, and a path to psql, or a write over it, is refused', () => {
    const wrapped = ['        run: P=true; $P -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], wrapped)).join('\n')).toMatch(/must run psql itself/);
    const byPath = ['        run: /usr/bin/psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], byPath)).join('\n')).toMatch(/replace the psql that runs the suites/);
    const overwrite = ['        run: sudo cp /tmp/shim /usr/local/bin/psql'];
    expect(policyProblems(workflowText(['alpha_tests'], overwrite)).join('\n')).toMatch(/replace the psql that runs the suites/);
  });

  it('a PATH, HOME, GITHUB_PATH, psqlrc or BASH_FUNC setting is refused, and so are hash, enable, select and coproc', () => {
    for (const setting of [
      'export PATH=$PWD/bin:$PATH',
      'HOME=/tmp/x',
      'echo /x >> "$GITHUB_PATH"',
      'echo x > ~/.psqlrc',
      "export BASH_FUNC_psql%%='() { :; }'",
    ]) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${setting}`])).join('\n'), setting).toMatch(
        /environment variable, file or shell setting/,
      );
    }
    for (const word of [
      'hash -p /tmp/x psql',
      'enable -f /tmp/x.so x',
      'select x in a; do psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql; done',
      'coproc psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql',
    ]) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${word}`])).join('\n'), word).toMatch(/a shell escape/);
    }
  });

  it('a container, or a local action or reusable workflow, in the database job is refused', () => {
    const container = workflowLines(['alpha_tests']);
    container.splice(container.indexOf('  database:') + 1, 0, '    container: ubuntu:22.04');
    expect(policyProblems(container.join('\n')).join('\n')).toMatch(/a container image/);
    const local = ['      - uses: ./.github/actions/run-suites'];
    expect(policyProblems(workflowText(['alpha_tests'], local)).join('\n')).toMatch(/a local action or reusable workflow/);
    const reusable = ['      - uses: owner/repo/.github/workflows/suites.yml@main'];
    expect(policyProblems(workflowText(['alpha_tests'], reusable)).join('\n')).toMatch(/a local action or reusable workflow/);
  });

  it('a # inside quotes is content, so a shell escape or a continue-on-error after it is still read', () => {
    const escape = ['        run: echo "domain #suites"; set +e'];
    expect(policyProblems(workflowText(['alpha_tests'], escape)).join('\n')).toMatch(/a shell escape/);
    const flow = ['      - { name: "Run RLS #rls", continue-on-error: true, run: echo x }'];
    expect(policyProblems(workflowText(['alpha_tests'], flow)).join('\n')).toMatch(/continue-on-error/);
  });

  it('a # after quotes still starts a comment, and what follows it is not read', () => {
    const steps = ['        run: echo "a" # psql -v ON_ERROR_STOP=1 -f supabase/tests/gamma_tests.sql'];
    expect(wiring(workflowText(['alpha_tests'], steps), fileMap({alpha_tests: '', gamma_tests: ''}))).toEqual({
      unwired: ['gamma_tests'],
      dangling: [],
    });
  });

  it('a shell function with empty parentheses is refused, whatever its body', () => {
    for (const fn of ['psql() ( true )', 'psql () { true; }', 'psql ( )  ( : )']) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${fn}`])).join('\n'), fn).toMatch(/shell function/);
    }
  });

  it('a folded (>) run block is refused, because YAML joins its lines into one command', () => {
    const steps = ['        run: >', '          echo running', '          psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/folded \(>\) run block/);
  });

  it('a GitHub expression is refused in the database job, except the postgres service id', () => {
    expect(policyProblems(workflowText(['alpha_tests'], ['        run: echo ${{ github.event.pull_request.title }}'])).join('\n')).toMatch(
      /GitHub expression/,
    );
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: echo ${{ 'trap ''exit 0'' EXIT' }}"])).join('\n')).toMatch(
      /GitHub expression/,
    );
    expect(
      policyProblems(workflowText(['alpha_tests'], ['        run: echo "${{ job.services.postgres.id }}"'])).join('\n'),
    ).not.toMatch(/GitHub expression/);
  });

  it('a database job on another runner, or an action other than checkout and setup-node, is refused', () => {
    const runner = workflowLines(['alpha_tests']);
    runner.splice(runner.indexOf('  database:') + 1, 0, '    runs-on: windows-latest');
    expect(policyProblems(runner.join('\n')).join('\n')).toMatch(/ubuntu runner/);
    const action = ['      - uses: owner/repo@v1'];
    expect(policyProblems(workflowText(['alpha_tests'], action)).join('\n')).toMatch(/an action the guard does not read/);
    const pinned = ['      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7'];
    expect(policyProblems(workflowText(['alpha_tests'], pinned)).join('\n')).not.toMatch(/an action the guard does not read/);
  });

  it('a types filter on pull_request, or a workflow with no pull_request trigger, is refused', () => {
    const types = ['on:', '  pull_request:', '    types: [closed]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], types)).join('\n')).toMatch(/types filter/);
    const flow = ['on: { pull_request: { types: [closed] } }'];
    expect(policyProblems(workflowText(['alpha_tests'], [], flow)).join('\n')).toMatch(/types filter/);
    const none = ['on:', '  push:', '    branches: [main]'];
    expect(policyProblems(workflowText(['alpha_tests'], [], none)).join('\n')).toMatch(/must run on pull_request/);
  });

  it('LD_PRELOAD, LD_LIBRARY_PATH, SHELLOPTS and BASHOPTS are refused as environment variables', () => {
    for (const name of ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'SHELLOPTS', 'BASHOPTS']) {
      const steps = ['      - name: Quiet', '        env:', `          ${name}: /tmp/x`, '        run: echo x'];
      expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n'), name).toMatch(
        /environment variable, file or shell setting/,
      );
    }
  });

  it('a cd, a file write, a git command or a redirection to a file is refused in the database job', () => {
    for (const cmd of [
      'cd supabase/tests',
      'cp /tmp/x supabase/tests/alpha_tests.sql',
      'echo x | tee log',
      'git checkout -- .',
      'sed -i s/a/b/ x',
      'echo x > supabase/tests/alpha_tests.sql',
    ]) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${cmd}`])).join('\n'), cmd).toMatch(
        /changes directory or writes files|redirection to a file/,
      );
    }
    const quiet = ['        run: echo x 2>&1 > /dev/null'];
    expect(policyProblems(workflowText(['alpha_tests'], quiet)).join('\n')).not.toMatch(
      /changes directory or writes files|redirection to a file/,
    );
  });

  it('a psql backslash command other than an include of a suite is refused', () => {
    const set = ['        run: psql -v ON_ERROR_STOP=1 -c "\\set ON_ERROR_STOP off" -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], set)).join('\n')).toMatch(/psql backslash command/);
    const quit = ['        run: psql -v ON_ERROR_STOP=1 -c "\\q" -f supabase/tests/beta_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], quit)).join('\n')).toMatch(/psql backslash command/);
    const include = ['        run: psql -v ON_ERROR_STOP=1 -c "\\i supabase/tests/beta_tests.sql"'];
    expect(policyProblems(workflowText(['alpha_tests'], include)).join('\n')).not.toMatch(/psql backslash command/);
  });

  it('a path under supabase/tests that is not a plain name.sql is refused', () => {
    const bak = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql.bak'];
    expect(policyProblems(workflowText(['alpha_tests'], bak)).join('\n')).toMatch(/not a plain name\.sql/);
  });

  it("a function after an ANSI-C quoted $'...' string is still read", () => {
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: echo $'\\'' ; psql() ( true )"])).join('\n')).toMatch(
      /shell function/,
    );
  });

  it('the database service image is pinned to postgres:16', () => {
    const other = workflowLines(['alpha_tests']);
    other.splice(other.indexOf('  database:') + 1, 0, '    services:', '      postgres:', '        image: postgres:17');
    expect(policyProblems(other.join('\n')).join('\n')).toMatch(/postgres:16/);
    const pinned = workflowLines(['alpha_tests']);
    pinned.splice(pinned.indexOf('  database:') + 1, 0, '    services:', '      postgres:', '        image: postgres:16');
    expect(policyProblems(pinned.join('\n')).join('\n')).not.toMatch(/postgres:16/);
  });

  it('a \\ before a quote does not open a quotation, so a comment after it is cut and a command after the quote is read', () => {
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: echo \\' ' #' ; exit 0"])).join('\n')).toMatch(
      /a command the guard does not allow/,
    );
  });

  it('the database job runs only the commands it uses: set +e, shopt, command, builtin, cd and a quoted command are refused', () => {
    for (const cmd of ['set +e', 'shopt -uo errexit', 'command set +e', 'builtin exit 0', "'set' +e", 'set -o noexec', 'cd supabase']) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${cmd}`])).join('\n'), cmd).toMatch(
        /a command the guard does not allow|set in the database job may only/,
      );
    }
    expect(policyProblems(workflowText(['alpha_tests'], ['        run: set -euo pipefail'])).join('\n')).not.toMatch(
      /set in the database job may only/,
    );
  });

  it('a psql call that runs a suite is only the plain form: no -V, -l, --, -F, -o, -c except lumin settings, or a connection string', () => {
    for (const call of [
      'psql -X -V -f supabase/tests/alpha_tests.sql',
      "psql -v ON_ERROR_STOP=1 -c 'select 1' -f supabase/tests/alpha_tests.sql",
      'psql -v ON_ERROR_STOP=1 -d "x=1" -f supabase/tests/alpha_tests.sql',
      'psql -v ON_ERROR_STOP=1 -f supabase/tests/alpha_tests.sql -f supabase/tests/beta_tests.sql',
      'psql -v ON_ERROR_STOP -f supabase/tests/alpha_tests.sql',
      'psql -v ON_ERROR_STOP=1 -F -f supabase/tests/alpha_tests.sql',
    ]) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: ${call}`])).join('\n'), call).toMatch(/a psql call that runs a suite/);
    }
    const plain = ['        run: psql -X -v ON_ERROR_STOP=1 -d lumin_test -f supabase/tests/alpha_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], plain)).join('\n')).not.toMatch(/a psql call that runs a suite/);
    const noStop = ['        run: psql -X -d lumin_test -f supabase/tests/alpha_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], noStop)).join('\n')).toMatch(/must set -v ON_ERROR_STOP=1/);
  });

  it('a line that names a suite may not be part of an && list', () => {
    const steps = ['        run: psql -v ON_ERROR_STOP=1 -f supabase/tests/beta_tests.sql && echo ok'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/an && list/);
  });

  it('a here-document, a backtick and ANSI-C quoting are refused in the database job', () => {
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: bash <<'EOF'"])).join('\n')).toMatch(/here-document/);
    expect(policyProblems(workflowText(['alpha_tests'], ['        run: echo `date`'])).join('\n')).toMatch(/backtick/);
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: echo $'a'"])).join('\n')).toMatch(/ANSI-C/);
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: echo x=$(echo y)"])).join('\n')).not.toMatch(/backtick|ANSI-C|here-document/);
  });

  it('check_asserts and ALTER DATABASE in the database job are refused', () => {
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: psql -c 'set plpgsql.check_asserts = off'"])).join('\n')).toMatch(
      /check_asserts/,
    );
    expect(policyProblems(workflowText(['alpha_tests'], ["        run: psql -c 'alter database x set a = 1'"])).join('\n')).toMatch(
      /ALTER DATABASE/,
    );
  });

  it('a suite may not write a file, run a backtick, or switch off ASSERT; \\echo, \\set and an include are fine', () => {
    expect(sqlProblems(fileMap({o: 'select 1;\n\\o out.txt\n'}))).toEqual(['o']);
    expect(sqlProblems(fileMap({w: 'select 1 \\w x.sql\n'}))).toEqual(['w']);
    expect(sqlProblems(fileMap({bt: '\\set x `date`\n'}))).toEqual(['bt']);
    expect(sqlProblems(fileMap({asserts: 'set plpgsql.check_asserts = off;\n'}))).toEqual(['asserts']);
    expect(sqlProblems(fileMap({alter: 'alter database x set a = 1;\n'}))).toEqual(['alter']);
    expect(sqlProblems(fileMap({fine: '\\set x 1\n\\echo ok\n\\ir fixture.sql\nselect 1;\n', fixture: 'select 1;\n'}))).toEqual([]);
  });

  it('the routing variables PGSERVICE, PGHOSTADDR, PGPASSFILE and DATABASE_URL may not be set in the database job', () => {
    for (const name of ['PGSERVICE', 'PGHOSTADDR', 'PGPASSFILE', 'DATABASE_URL']) {
      expect(policyProblems(workflowText(['alpha_tests'], [`        run: export ${name}=x`])).join('\n'), name).toMatch(
        /environment variable, file or shell setting/,
      );
    }
  });

  it('the domain loop header is exempt from command checks only when it is names; a substitution in its word list is read', () => {
    const steps = ['        run: |', '          for s in $(echo x; set +e); do', '            echo "$s"', '          done'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/set in the database job may only/);
  });

  it('a command substitution or a quotation not closed on its line is refused, since bash reads the next line as part of it', () => {
    const steps = ['        run: |', '          echo $(', '          psql -X -v ON_ERROR_STOP=1 -f supabase/tests/alpha_tests.sql', '          )'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/not closed on its line/);
  });

  it('a suite path may appear only as the -f file of a psql call that runs it', () => {
    const steps = ['        run: psql -v ON_ERROR_STOP=1 -d lumin_test -f supabase/tests/alpha_tests.sql; echo "skipping supabase/tests/beta_tests.sql"'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/a suite path may appear only as the -f file/);
  });

  it('ON_ERROR_STOP is a case-sensitive name: on_error_stop=1 does not turn it on, so it is refused', () => {
    const steps = ['        run: psql -v on_error_stop=1 -d lumin_test -f supabase/tests/alpha_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], steps)).join('\n')).toMatch(/a psql call that runs a suite may only be/);
  });

  it('a run value continues on more indented lines, and a block scalar with an indentation digit is read', () => {
    const continued = ['        run: echo ok', '          ; psql -V -f supabase/tests/alpha_tests.sql'];
    expect(policyProblems(workflowText(['alpha_tests'], continued)).join('\n')).toMatch(/a psql call that runs a suite/);
    const digit = ['        run: |2', '            set +e'];
    expect(policyProblems(workflowText(['alpha_tests'], digit)).join('\n')).toMatch(/set in the database job may only/);
  });
});
