import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App, PortalApplication } from "../App";

const runtime = vi.hoisted(() => ({
  signIn: vi.fn(), memberships: vi.fn(), bookings: vi.fn(), services: vi.fn(), setServiceActive: vi.fn(), signOut: vi.fn(), unexpectedNetwork: vi.fn(),
}));
vi.mock("@lumin/runtime-client", async importOriginal => {
  const actual = await importOriginal<typeof import("@lumin/runtime-client")>();
  return {
  ...actual,
  readPublicRuntimeConfig: (env: Record<string, unknown>) => ({
    environment: typeof env.VITE_RUNTIME_ENV === "string" && env.VITE_RUNTIME_ENV.trim()
      ? env.VITE_RUNTIME_ENV.trim()
      : "demo",
    mode: typeof env.VITE_RUNTIME_MODE === "string" && env.VITE_RUNTIME_MODE.trim()
      ? env.VITE_RUNTIME_MODE.trim()
      : "demo",
    apiOrigin: typeof env.VITE_API_ORIGIN === "string" && env.VITE_API_ORIGIN.trim()
      ? env.VITE_API_ORIGIN.trim()
      : undefined,
    flowApiOrigin: typeof env.VITE_FLOW_API_URL === "string" && env.VITE_FLOW_API_URL.trim()
      ? env.VITE_FLOW_API_URL.trim()
      : undefined,
    supabaseUrl: typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "",
    supabasePublishableKey: typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string"
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : "",
    tenantId: typeof env.VITE_TENANT_ID === "string" ? env.VITE_TENANT_ID.trim() : "",
  }),
  createRuntimeClient: (config: Parameters<typeof actual.createRuntimeClient>[0]) => {
    // Preserve the complete connected state contract; navigation only replaces
    // the identity/catalog reads and service mutation exercised below.
    const client = actual.createRuntimeClient(config, async () => {
      runtime.unexpectedNetwork();
      throw new Error("Unexpected network request from navigation fixture");
    });
    return { ...client, ...runtime };
  },
};
});

const labels = ["Home", "Bookings", "Booking Form", "Services & Pricing", "Settings"];
const tenant = "11111111-1111-4111-8111-111111111111";
function portal(path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><PortalApplication /></MemoryRouter>);
}
function connected() {
  vi.stubEnv("VITE_RUNTIME_MODE", "supabase");
  vi.stubEnv("VITE_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_fixture");
  vi.stubEnv("VITE_TENANT_ID", tenant);
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("VITE_RUNTIME_MODE", "mock"); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState({}, "", "/"); });

describe("Portal navigation migration", () => {
  it.each(["mock", "supabase"])("uses exactly five ordered primary destinations in %s mode", mode => {
    vi.stubEnv("VITE_RUNTIME_MODE", mode);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    portal();
    const links = within(screen.getByRole("navigation", { name: "Portal sections" })).getAllByRole("link");
    expect(links).toHaveLength(5);
    labels.forEach((label, index) => expect(links[index]).toHaveTextContent(label));
    if (mode === "supabase") {
      expect(screen.getByRole("alert")).toHaveTextContent("configuration is missing or invalid");
      expect(screen.queryByTestId("stat-week-revenue")).not.toBeInTheDocument();
      expect(screen.queryByText(/sample data stays/)).not.toBeInTheDocument();
    }
  });

  it.each([
    ["availability", "calendar/availability", "Availability"],
    ["resources", "services/resources", "Resources"],
    ["checkout", "embed", "Embed Builder"],
  ])("retains query/hash for legacy %s and renders its canonical path on refresh", async (legacy, target, heading) => {
    vi.stubEnv("BASE_URL", "/portal/");
    window.history.replaceState({}, "", `/portal/${legacy}?view=week#details`);
    const first = render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe(`/portal/${target}`));
    expect(window.location.search).toBe("?view=week");
    expect(window.location.hash).toBe("#details");
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
  });

  it("resolves static resource/template/new paths before service identifiers", () => {
    const view = portal("/services/resources");
    expect(screen.getByRole("heading", { level: 1, name: "Resources" })).toBeInTheDocument();
    expect(screen.queryByText("Service not found")).not.toBeInTheDocument();
    view.unmount();
    const templates = portal("/services/templates");
    expect(screen.getByTestId("template-catalog")).toBeInTheDocument();
    templates.unmount();
    portal("/services/new");
    expect(screen.getByRole("heading", { name: "Create service" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not available yet");
  });

  it.each(["/workers", "/pricing", "/invoices", "/calendar/map", "/embed/flows/new"])("does not invent working controls for %s", path => {
    portal(path);
    expect(screen.getByRole("status")).toHaveTextContent("not available yet");
    expect(within(screen.getByRole("main")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not offer a fake installation snippet in the retained demo builder preview", () => {
    portal("/embed");
    expect(screen.getByText("Installation is not available yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy snippet/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/cdn.bookinglumin.example/)).not.toBeInTheDocument();
  });

  it("honors legacy links in connected mode even with invalid configuration", async () => {
    connected(); vi.stubEnv("VITE_SUPABASE_URL", ""); vi.stubEnv("BASE_URL", "/portal/");
    window.history.replaceState({}, "", "/portal/checkout?flow=test#design");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/portal/embed"));
    expect(window.location.search + window.location.hash).toBe("?flow=test#design");
    expect(screen.getByRole("alert")).toHaveTextContent("configuration is missing or invalid");
    expect(screen.queryByTestId("checkout-preview")).not.toBeInTheDocument();
  });

  it("keeps authenticated bookings and service activation across navigation without rendering demo data", async () => {
    connected();
    runtime.signIn.mockResolvedValue("user");
    runtime.memberships.mockResolvedValue([{ tenant_id: tenant, role: "BUSINESS_OWNER" }]);
    runtime.bookings.mockResolvedValue([
      { id: "draft", tenant_id: tenant, reference: "LIVE-REQUEST", state: "draft", slot_start: "2030-01-01T10:00:00Z" },
      { id: "confirmed", tenant_id: tenant, reference: "CONFIRMED-BOOKING", state: "confirmed", slot_start: "2030-01-02T10:00:00Z" },
    ]);
    runtime.services.mockResolvedValue([{ id: "service", tenant_id: tenant, name: "Connected service", active: true }]);
    runtime.setServiceActive.mockResolvedValue(undefined);
    portal("/bookings");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("LIVE-REQUEST")).toBeInTheDocument();
    expect(screen.getByText("CONFIRMED-BOOKING")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(runtime.bookings).toHaveBeenCalledWith(tenant);
    const navigation = screen.getByRole("navigation", { name: "Portal sections" });
    fireEvent.click(within(navigation).getByRole("link", { name: /Services & Pricing/ }));
    expect(await screen.findByText(/Connected service/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(runtime.setServiceActive).toHaveBeenCalledWith(tenant, "service", false));
    fireEvent.click(within(navigation).getByRole("link", { name: /Booking Form/ }));
    if (import.meta.env.VITE_RUNTIME_ENV === "staging" && import.meta.env.VITE_FLOW_API_URL?.trim()) {
      expect(await screen.findByRole("tab", { name: "Build" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Booking Form", level: 1 })).toBeInTheDocument();
      expect(screen.getByText(/Payment is simulated/)).toBeInTheDocument();
    } else {
      expect(screen.getByRole("status")).toHaveTextContent("not available yet");
    }
    expect(screen.queryByTestId("checkout-preview")).not.toBeInTheDocument();
    expect(runtime.signIn).toHaveBeenCalledTimes(1);
    expect(runtime.unexpectedNetwork).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(runtime.signOut).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Sign in to your business" })).toBeInTheDocument();
    expect(screen.queryByText("LIVE-REQUEST")).not.toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED-BOOKING")).not.toBeInTheDocument();
  });
  it.each(["resolve", "reject"])("discards a service mutation %s after logout and a different login", async outcome => {
    connected();
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    runtime.signIn.mockResolvedValue("user");
    runtime.memberships.mockResolvedValueOnce([{ tenant_id: tenant, role: "BUSINESS_OWNER" }])
      .mockResolvedValueOnce([{ tenant_id: otherTenant, role: "BUSINESS_OWNER" }]);
    runtime.bookings.mockResolvedValue([]);
    runtime.services.mockImplementation(async id => [{ id: "service", tenant_id: id, name: id === tenant ? "Old business service" : "New business service", active: true }]);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    runtime.setServiceActive.mockReturnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    portal("/services");
    const signIn = () => {
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    };
    signIn();
    await screen.findByText(/Old business service/);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    signIn();
    await screen.findByText(/New business service/);
    const reads = runtime.services.mock.calls.length;
    if (outcome === "resolve") resolve(); else reject(new Error("Old session private failure"));
    // Drain the mutation continuation, including a possible stale reload.
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
    await new Promise(done => setTimeout(done, 0));
    expect(runtime.services).toHaveBeenCalledTimes(reads);
    expect(screen.getByText(/New business service/)).toBeInTheDocument();
    expect(screen.queryByText(/Old business service/)).not.toBeInTheDocument();
    expect(screen.queryByText("Old session private failure")).not.toBeInTheDocument();
  });

});

