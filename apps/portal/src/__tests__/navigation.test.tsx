import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App, PortalApplication } from "../App";

const runtime = vi.hoisted(() => ({
  signIn: vi.fn(), memberships: vi.fn(), drafts: vi.fn(), services: vi.fn(), setServiceActive: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@lumin/runtime-client", () => ({ createRuntimeClient: (config: { url: string }) => {
  if (!config.url) throw new Error("Invalid config");
  return runtime;
} }));

const labels = ["Dashboard", "Bookings", "Calendar", "Workers", "Customers", "Services", "Pricing", "Invoices", "Embed Builder", "Media", "Integrations", "Settings"];
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
  it.each(["mock", "supabase"])("uses exactly twelve ordered primary destinations in %s mode", mode => {
    vi.stubEnv("VITE_RUNTIME_MODE", mode);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    portal();
    const links = within(screen.getByRole("navigation", { name: "Portal sections" })).getAllByRole("link");
    expect(links).toHaveLength(12);
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

  it("keeps authenticated drafts and service activation across navigation without rendering demo data", async () => {
    connected();
    runtime.signIn.mockResolvedValue("user");
    runtime.memberships.mockResolvedValue([{ tenant_id: tenant, role: "BUSINESS_OWNER" }]);
    runtime.drafts.mockResolvedValue([{ id: "draft", reference: "LIVE-REQUEST", state: "draft", slot_start: "2030-01-01T10:00:00Z" }]);
    runtime.services.mockResolvedValue([{ id: "service", tenant_id: tenant, name: "Connected service", active: true }]);
    runtime.setServiceActive.mockResolvedValue(undefined);
    portal("/bookings");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("LIVE-REQUEST")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Portal sections" });
    fireEvent.click(within(navigation).getByRole("link", { name: /Services/ }));
    expect(await screen.findByText(/Connected service/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(runtime.setServiceActive).toHaveBeenCalledWith(tenant, "service", false));
    fireEvent.click(within(navigation).getByRole("link", { name: /Embed Builder/ }));
    expect(screen.getByRole("status")).toHaveTextContent("not available yet");
    expect(screen.queryByTestId("checkout-preview")).not.toBeInTheDocument();
    expect(runtime.signIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(runtime.signOut).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Sign in to your business" })).toBeInTheDocument();
    expect(screen.queryByText("LIVE-REQUEST")).not.toBeInTheDocument();
  });
  it.each(["resolve", "reject"])("discards a service mutation %s after logout and a different login", async outcome => {
    connected();
    const otherTenant = "22222222-2222-4222-8222-222222222222";
    runtime.signIn.mockResolvedValue("user");
    runtime.memberships.mockResolvedValueOnce([{ tenant_id: tenant, role: "BUSINESS_OWNER" }])
      .mockResolvedValueOnce([{ tenant_id: otherTenant, role: "BUSINESS_OWNER" }]);
    runtime.drafts.mockResolvedValue([]);
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
