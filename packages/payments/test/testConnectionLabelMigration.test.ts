/**
 * Migration 0094 declares the TEST-MODE Stripe label confirmable on a disposable
 * database, and on no other.
 *
 * The CI database job runs only on lumin_* databases, so it can show that the label
 * IS seeded there. It cannot show that it is NOT seeded on a hosted database, which
 * is the production posture: the same branch is never taken in CI. So this pins the
 * other half at the source, the way connectionCapability.test.ts pins 0088. Comment
 * lines are stripped first, so the prose that names the label does not count.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0094_stripe_connect_test_label.sql", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 0094 declares the test-mode label on a disposable database only", () => {
  const LABEL = "'stripe_connect_test'";
  const guard = sql.indexOf("current_database() ~ '^lumin_'");
  const insert = sql.indexOf(LABEL);
  const endIf = sql.indexOf("end if");

  it("names the label exactly once, as an insert into the confirmable allowlist", () => {
    expect(sql.split(LABEL).length - 1).toBe(1);
    expect(sql).toMatch(/insert into public\.confirmable_payment_providers/);
  });

  it("the insert sits inside the disposable-database guard, and is never reached without it", () => {
    expect(guard, "the guard is present").toBeGreaterThan(-1);
    expect(insert, "the insert comes after the guard").toBeGreaterThan(guard);
    expect(insert, "the insert is closed by the guard's end if").toBeLessThan(endIf);
  });
});
