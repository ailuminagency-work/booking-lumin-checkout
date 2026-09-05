import { describe, expect, it } from "vitest";
import { normalizePhone, isPlausiblePhone, callingCodeFor, CALLING_CODES } from "../src/phone";

/**
 * Phone normalization is country-aware and dependency-free. The country is an
 * explicit input; it is never inferred from locale/currency/timezone. These are
 * shape helpers, NOT full validation.
 */
describe("normalizePhone — attach calling code per default country", () => {
  it("MX national number → +52…", () => {
    expect(normalizePhone("(55) 5555-1234", "MX")).toBe("+525555551234");
    expect(normalizePhone("55 5555 1234", "MX")).toBe("+525555551234");
  });

  it("NL national number → +31…, dropping the trunk 0", () => {
    expect(normalizePhone("06 12345678", "NL")).toBe("+31612345678");
    expect(normalizePhone("020 123 4567", "NL")).toBe("+31201234567");
  });

  it("US national number → +1…", () => {
    expect(normalizePhone("(415) 555-2671", "US")).toBe("+14155552671");
    expect(normalizePhone("415.555.2671", "US")).toBe("+14155552671");
  });

  it("already-'+'-prefixed input is preserved (formatting stripped only)", () => {
    expect(normalizePhone("+44 20 7946 0958", "GB")).toBe("+442079460958");
    // Default country is irrelevant when a '+' is present.
    expect(normalizePhone("+81 3-1234-5678", "US")).toBe("+81312345678");
  });

  it("'00' international access prefix becomes '+'", () => {
    expect(normalizePhone("0031 20 1234567", "US")).toBe("+31201234567");
  });

  it("US/MX do NOT strip a leading 0 (no national trunk 0)", () => {
    // Contrast with NL above: here the leading 0 is a normal digit.
    expect(normalizePhone("0155512345", "MX")).toBe("+520155512345");
  });

  it("unknown default country yields a '+'-prefixed best effort", () => {
    expect(normalizePhone("12345678", "ZZ")).toBe("+12345678");
  });
});

describe("isPlausiblePhone — coarse sanity gate", () => {
  it("accepts plausible national and international numbers", () => {
    expect(isPlausiblePhone("(55) 5555-1234", "MX")).toBe(true);
    expect(isPlausiblePhone("06 12345678", "NL")).toBe(true);
    expect(isPlausiblePhone("+44 20 7946 0958", "GB")).toBe(true);
  });

  it("flags implausible input (letters, too short, empty)", () => {
    expect(isPlausiblePhone("CALL-ME-NOW", "US")).toBe(false);
    expect(isPlausiblePhone("12", "US")).toBe(false); // → "+112", only 3 digits
    expect(isPlausiblePhone("", "US")).toBe(false);
    expect(isPlausiblePhone("55 5555 1234 5678 9012", "MX")).toBe(false); // too long (>15 digits E.164)
  });
});

describe("CALLING_CODES map", () => {
  it("covers the required countries", () => {
    expect(callingCodeFor("US")).toBe("1");
    expect(callingCodeFor("MX")).toBe("52");
    expect(callingCodeFor("NL")).toBe("31");
    expect(callingCodeFor("BR")).toBe("55");
    expect(callingCodeFor("JP")).toBe("81");
    expect(callingCodeFor("GB")).toBe("44");
    expect(callingCodeFor("DE")).toBe("49");
    expect(callingCodeFor("ES")).toBe("34");
  });

  it("is case-insensitive and returns undefined for unknown codes", () => {
    expect(callingCodeFor("us")).toBe("1");
    expect(callingCodeFor("ZZ")).toBeUndefined();
    expect(CALLING_CODES.US).toBe("1");
  });
});
