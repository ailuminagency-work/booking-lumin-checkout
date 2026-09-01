import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { TenantContext } from "@lumin/contracts";
import type { PortalStore } from "../data/mockTenant";
import { appStore, demoContext } from "../data/mockTenant";

interface PortalValue {
  ctx: TenantContext;
  store: PortalStore;
}

const PortalContext = createContext<PortalValue | null>(null);

export function PortalProvider({
  children,
  ctx = demoContext,
  store = appStore,
}: {
  children: ReactNode;
  ctx?: TenantContext;
  store?: PortalStore;
}) {
  return <PortalContext.Provider value={{ ctx, store }}>{children}</PortalContext.Provider>;
}

/**
 * Access the tenant context + store, subscribed to store changes so any
 * mutation (booking transition, settings edit) re-renders consumers.
 */
export function usePortal(): PortalValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error("usePortal must be used within PortalProvider");
  useSyncExternalStore(value.store.subscribe, value.store.getVersion, value.store.getVersion);
  return value;
}
