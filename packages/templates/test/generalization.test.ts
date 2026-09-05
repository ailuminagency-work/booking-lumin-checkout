import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPricingEngine } from "@lumin/core";
import { listTemplates } from "../src/registry";
import { templateCases } from "./fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(here, "../../core/src");
const ADAPTERS_SRC = resolve(here, "../../adapters/src");

function readAllSource(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readAllSource(full));
    } else if (full.endsWith(".ts")) {
      out.push({ file: full, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

/**
 * The generalization invariant: verticals are DATA. The engines never branch on
 * a template key. If any template key ever appears in the pricing / availability
 * / booking engines or the adapters, someone forked the engine per vertical —
 * exactly what this platform forbids.
 */
describe("no vertical-specific branch leaks into the engines or adapters", () => {
  const keys = listTemplates().map((t) => t.key);

  it("exposes eight distinct template keys", () => {
    expect(new Set(keys).size).toBe(8);
  });

  for (const dir of [CORE_SRC, ADAPTERS_SRC]) {
    it(`no template key appears anywhere in ${dir.split("/packages/")[1]}`, () => {
      const sources = readAllSource(dir);
      expect(sources.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      for (const { file, text } of sources) {
        for (const key of keys) {
          if (text.includes(key)) offenders.push(`${key} in ${file}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("all templates run on the very same engine function instances", () => {
  it("one createPricingEngine().price prices all eight verticals", () => {
    const engine = createPricingEngine();
    const priced = templateCases().map((c) => ({
      key: c.key,
      total: engine.price(c.service, c.selection).total.amount,
    }));
    // Same function object priced every vertical; totals match the fixtures.
    expect(priced).toEqual(templateCases().map((c) => ({ key: c.key, total: c.total })));
  });
});
