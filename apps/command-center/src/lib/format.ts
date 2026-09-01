import { formatMoney } from "@lumin/contracts";

/** All money display goes through the contracts formatMoney (minor units in). */
export function usd(minorUnits: number): string {
  return formatMoney({ amount: minorUnits, currency: "USD" });
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}
