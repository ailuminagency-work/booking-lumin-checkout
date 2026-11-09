import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * The production start path must not depend on a devDependency.
 *
 * render.yaml pins NODE_ENV=production and builds with `npm ci`. The service boots
 * today only because Render's build installs devDependencies anyway; the moment that
 * changes — an `--omit=dev`, a `production=true` in an npmrc, a different host — the
 * container would start, fail to resolve the loader named in `start`, and die. The
 * failure would look like a deploy problem, not like a dependency that was filed in
 * the wrong section.
 *
 * These assertions are about the SHAPE of the manifest, so the regression is caught
 * here rather than on a production host.
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const yaml = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

/** The first bare executable an npm script shells out to, e.g. `tsx src/main.ts` -> `tsx`. */
function runner(script: string): string {
  const first = script.trim().split(/\s+/)[0] ?? '';
  return first;
}

it('every runner the start script invokes is a runtime dependency', () => {
  const name = runner(pkg.scripts.start ?? '');
  expect(name, 'start script must name a runner').not.toBe('');
  // `node` is the platform itself and is never a package.
  if (name === 'node') return;
  expect(
    pkg.dependencies[name],
    `${name} is invoked by "start" so it must be in dependencies, not devDependencies (npm ci --omit=dev would drop it and the service would not boot)`,
  ).toBeDefined();
  expect(pkg.devDependencies[name], `${name} must not ALSO be a devDependency`).toBeUndefined();
});

it('the blueprint still runs the scripts these assertions check', () => {
  // If render.yaml stops going through npm run start/build, the coupling above is
  // vacuous and this test would pass while proving nothing.
  expect(yaml).toMatch(/startCommand:\s*npm run start/);
  expect(yaml).toMatch(/buildCommand:.*npm run build/);
});

it('the build script is not a no-op', () => {
  // It used to be `node -e "process.exit(0)"`. A build step that cannot fail cannot
  // stop a broken deploy, and `tsx` transpiles without typechecking, so a type error
  // would otherwise reach a running container.
  const build = pkg.scripts.build ?? '';
  expect(build).not.toBe('');
  expect(build, 'build must do real work').not.toMatch(/process\.exit\(0\)/);
  expect(build, 'build must typecheck or compile').toMatch(/tsc|esbuild|rollup|vite|swc/);
});
