import { describe, expect, it } from "vitest";
import type { Address } from "@lumin/contracts";
import { formatAddressLines, formatAddressBlock, addressFormatFor, countryDisplayName } from "../src/address";

/**
 * Address layout follows the destination country's convention — chosen from the
 * `country` code, never hard-coded to US. Optional region/postalCode are omitted
 * gracefully. Locale is an independent input affecting only the country name.
 */
describe("formatAddressLines — country-appropriate ordering", () => {
  it("US: recipient lines, then 'City, REGION postal', then country", () => {
    const us: Address = {
      line1: "1600 Amphitheatre Pkwy",
      city: "Mountain View",
      region: "CA",
      postalCode: "94043",
      country: "US",
    };
    expect(formatAddressLines(us, "en-US")).toEqual([
      "1600 Amphitheatre Pkwy",
      "Mountain View, CA 94043",
      "United States",
    ]);
  });

  it("NL: recipient lines, then 'postal City', then country", () => {
    const nl: Address = {
      line1: "Herengracht 500",
      city: "Amsterdam",
      postalCode: "1017 CB",
      country: "NL",
    };
    expect(formatAddressLines(nl, "nl-NL")).toEqual(["Herengracht 500", "1017 CB Amsterdam", "Nederland"]);
  });

  it("JP: postal, then 'Region City', then street line, then country", () => {
    const jp: Address = {
      line1: "2-7-2 Marunouchi",
      city: "Chiyoda",
      region: "Tokyo",
      postalCode: "100-0005",
      country: "JP",
    };
    expect(formatAddressLines(jp, "ja-JP")).toEqual(["〒100-0005", "Tokyo Chiyoda", "2-7-2 Marunouchi", "日本"]);
    // Locale only changes the country name, not the ordering.
    expect(formatAddressLines(jp, "en-US")).toEqual(["〒100-0005", "Tokyo Chiyoda", "2-7-2 Marunouchi", "Japan"]);
  });

  it("omits optional region/postalCode gracefully", () => {
    const usMinimal: Address = { line1: "1 Main St", city: "Anytown", country: "US" };
    // No trailing comma, no empty postal fragment.
    expect(formatAddressLines(usMinimal, "en-US")).toEqual(["1 Main St", "Anytown", "United States"]);

    const nlMinimal: Address = { line1: "Dorpsstraat 1", city: "Utrecht", country: "NL" };
    expect(formatAddressLines(nlMinimal, "nl-NL")).toEqual(["Dorpsstraat 1", "Utrecht", "Nederland"]);

    const jpNoPostal: Address = { line1: "1-1", city: "Chiyoda", region: "Tokyo", country: "JP" };
    expect(formatAddressLines(jpNoPostal, "en-US")).toEqual(["Tokyo Chiyoda", "1-1", "Japan"]);
  });

  it("includes line2 when present", () => {
    const withLine2: Address = {
      line1: "350 Fifth Ave",
      line2: "Suite 200",
      city: "New York",
      region: "NY",
      postalCode: "10118",
      country: "US",
    };
    expect(formatAddressLines(withLine2, "en-US")).toEqual([
      "350 Fifth Ave",
      "Suite 200",
      "New York, NY 10118",
      "United States",
    ]);
  });

  it("falls back to a sensible default for an unmapped country", () => {
    const other: Address = {
      line1: "Some Street 5",
      city: "Bern",
      postalCode: "3000",
      country: "CH",
    };
    // Default: recipient, then 'postal City Region', then country.
    expect(formatAddressLines(other, "en-US")).toEqual(["Some Street 5", "3000 Bern", "Switzerland"]);
    expect(addressFormatFor("CH")).toBe(addressFormatFor("ZZ")); // both use the default strategy
  });

  it("formatAddressBlock joins lines with newlines", () => {
    const us: Address = { line1: "1 Main St", city: "Anytown", region: "TX", postalCode: "75001", country: "US" };
    expect(formatAddressBlock(us, "en-US")).toBe("1 Main St\nAnytown, TX 75001\nUnited States");
  });
});

describe("countryDisplayName", () => {
  it("localizes the country name from an ISO 3166-1 alpha-2 code", () => {
    expect(countryDisplayName("US", "en-US")).toBe("United States");
    expect(countryDisplayName("NL", "nl-NL")).toBe("Nederland");
    expect(countryDisplayName("JP", "en-US")).toBe("Japan");
  });
});
