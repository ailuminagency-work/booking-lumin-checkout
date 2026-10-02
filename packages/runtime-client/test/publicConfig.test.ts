import { describe, expect, it } from "vitest";
import { readPublicRuntimeConfig } from "../src/publicConfig";

describe("public runtime configuration", () => {
  it("defaults to the safe demo runtime", () => {
    expect(readPublicRuntimeConfig({})).toEqual({
      environment: "demo",
      mode: "demo",
      apiOrigin: undefined,
      flowApiOrigin: undefined,
      supabaseUrl: "",
      supabasePublishableKey: "",
      tenantId: "",
    });
  });

  it("requires an explicit connected mode for staging", () => {
    expect(() => readPublicRuntimeConfig({ VITE_RUNTIME_ENV: "staging" })).toThrow(
      "Connected mode is required outside demo",
    );
  });

  it("normalizes staging origins and falls back to the API origin for flows", () => {
    expect(
      readPublicRuntimeConfig({
        VITE_RUNTIME_ENV: "staging",
        VITE_RUNTIME_MODE: "supabase",
        VITE_API_ORIGIN: "https://booking-lumin-api-staging.onrender.com/",
        VITE_SUPABASE_URL: " https://staging-project.supabase.co ",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging_fixture",
        VITE_TENANT_ID: "tenant-staging",
      }),
    ).toEqual({
      environment: "staging",
      mode: "supabase",
      apiOrigin: "https://booking-lumin-api-staging.onrender.com",
      flowApiOrigin: "https://booking-lumin-api-staging.onrender.com",
      supabaseUrl: "https://staging-project.supabase.co",
      supabasePublishableKey: "sb_publishable_staging_fixture",
      tenantId: "tenant-staging",
    });
  });

  it("allows loopback HTTP only for local harnesses", () => {
    expect(
      readPublicRuntimeConfig({
        VITE_RUNTIME_ENV: "demo",
        VITE_RUNTIME_MODE: "demo",
        VITE_API_ORIGIN: "http://127.0.0.1:8787/",
      }).apiOrigin,
    ).toBe("http://127.0.0.1:8787");
    expect(() =>
      readPublicRuntimeConfig({
        VITE_RUNTIME_ENV: "staging",
        VITE_RUNTIME_MODE: "supabase",
        VITE_API_ORIGIN: "http://staging-api.example.test",
      }),
    ).toThrow("VITE_API_ORIGIN must be an HTTPS origin");
  });

  it("rejects malformed origins", () => {
    expect(() => readPublicRuntimeConfig({ VITE_API_ORIGIN: "not a URL" })).toThrow(
      "VITE_API_ORIGIN must be an absolute origin",
    );
  });

  it.each([
    "https://api.example.test/path",
    "https://user:password@api.example.test",
    "https://api.example.test?token=secret",
  ])("rejects unsafe API origins: %s", (apiOrigin) => {
    expect(() => readPublicRuntimeConfig({ VITE_API_ORIGIN: apiOrigin })).toThrow(
      "VITE_API_ORIGIN must be an HTTPS origin",
    );
  });
});
