/**
 * The credential headers must be pinned AFTER any caller-supplied header map.
 *
 * `authHeaders(extra)` is the one function every Stripe request goes through,
 * in both copies of the client. It used to spread `...extra` LAST, so a call
 * site that passed a caller-derived map could silently replace Authorization.
 * No call site does -- the only key passed is a literal "Idempotency-Key" --
 * so this closes a class, not a live hole.
 *
 * WHY A SOURCE-SHAPE TEST AND NOT A BEHAVIOURAL ONE. `authHeaders` is private
 * to the factory and no public operation lets a caller choose a header NAME, so
 * the ordering cannot be observed through the public API -- which is precisely
 * why the change is safe, and precisely why a behavioural test cannot catch a
 * regression. I checked: a behavioural test passes under BOTH orderings. This
 * asserts the property where it actually lives, the same way
 * production-start-path.test.ts pins the manifest and noRefundPrimitive.test.ts
 * pins the adapter shape.
 *
 * It also covers supabase/functions/_shared/stripe.ts, the deliberate Deno
 * duplicate, which has no test harness of its own.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SOURCES: Array<[string, URL]> = [
  ["packages/adapters/src/stripePayment.ts", new URL("../src/stripePayment.ts", import.meta.url)],
  ["supabase/functions/_shared/stripe.ts", new URL("../../../supabase/functions/_shared/stripe.ts", import.meta.url)],
];

describe("authHeaders pins the credential after the caller's headers", () => {
  for (const [name, url] of SOURCES) {
    it(`${name} spreads ...extra before Authorization`, () => {
      const src = readFileSync(url, "utf8");
      const start = src.indexOf("function authHeaders(");
      expect(start, `${name} must define authHeaders`).toBeGreaterThan(-1);
      // From the RETURNED OBJECT only, with comment lines stripped. The
      // explanatory comment above that object contains the words "...extra",
      // and including it made an earlier version of this test vacuous: it
      // passed under both orderings because it matched the comment.
      const fnBody = src.slice(start, src.indexOf("\n  }", start));
      const body = fnBody
        .slice(fnBody.indexOf("return {"))
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      const spread = body.indexOf("...extra");
      const auth = body.indexOf("Authorization:");
      const contentType = body.indexOf('"Content-Type":');
      expect(spread, "authHeaders must accept a caller header map").toBeGreaterThan(-1);
      expect(auth, "authHeaders must set Authorization").toBeGreaterThan(-1);
      expect(contentType, "authHeaders must set Content-Type").toBeGreaterThan(-1);
      expect(spread, `${name}: ...extra must come BEFORE Authorization, or a caller header can replace the bearer`)
        .toBeLessThan(auth);
      expect(spread, `${name}: ...extra must come BEFORE Content-Type`).toBeLessThan(contentType);
    });
  }
});
