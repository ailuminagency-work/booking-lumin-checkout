/**
 * Migration 0094 declares the TEST-MODE Stripe label confirmable on a disposable
 * database, and on no other.
 *
 * The CI database job runs only on lumin_* databases, so it can show that the label
 * IS seeded there. It cannot show that it is NOT seeded on a hosted database, which
 * is the production posture: the same branch is never taken in CI. So this pins the
 * other half at the source, the way connectionCapability.test.ts pins 0088.
 *
 * The pin is the WHOLE seed block, normalised, not a substring. A substring pin passed
 * when the guard was widened to `'^lumin_' or true` or when a second statement joined
 * the block, because both kept the label's text inside the file. Comment lines are
 * stripped first, so the prose that names the label does not count.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0094_stripe_connect_test_label.sql", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ")
  .trim();

/** The body of the one seed block, between its dollar-quoted delimiters. */
const seedBlock = /do \$seed\$ (.*) end \$seed\$;/.exec(sql)?.[1];

describe("migration 0094 declares the test-mode label on a disposable database only", () => {
  it("has exactly one seed block, and the label is inserted nowhere else", () => {
    expect(sql.match(/do \$seed\$/g)?.length, "one seed block").toBe(1);
    expect(sql.match(/insert into public\.confirmable_payment_providers/g)?.length, "one insert").toBe(1);
    expect(sql.match(/stripe_connect_test/g)?.length, "the label named once").toBe(1);
  });

  it("the seed block is exactly the disposable-database guard around the one insert, and nothing else", () => {
    expect(seedBlock).toBe(
      "begin if current_database() ~ '^lumin_' then " +
        "insert into public.confirmable_payment_providers (provider, note) " +
        "values ('stripe_connect_test', 'Stripe Connect TEST-MODE connections; confirmable only on a disposable database') " +
        "on conflict (provider) do nothing; " +
        "end if;",
    );
  });

  it("the migration writes the allowlist nowhere but that block", () => {
    expect(sql).not.toMatch(/\b(update|delete)\b/i);
  });
});
