import type { ReactNode } from "react";
import type { BookingState } from "@lumin/contracts";

/** Human labels for booking states, used everywhere a state is shown. */
export const STATE_LABELS: Record<BookingState, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  failed: "Failed",
};

export function StateBadge({ state }: { state: BookingState }) {
  return <span className={`badge state-${state}`}>{STATE_LABELS[state]}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-glyph" aria-hidden="true">
        ◌
      </div>
      <p className="empty-state-title">{title}</p>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div className="page-header-actions">{children}</div> : null}
    </header>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const FULL_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Display helpers for UTC ISO instants (rendered as UTC for determinism). */
export function formatSlot(startIso: string, endIso: string): string {
  return `${DATE_FMT.format(new Date(startIso))}, ${TIME_FMT.format(new Date(startIso))}–${TIME_FMT.format(new Date(endIso))}`;
}

export function formatInstant(iso: string): string {
  return FULL_FMT.format(new Date(iso));
}

/** Minutes-from-midnight (tenant timezone) → "9:00 AM". Integer math only. */
export function minuteLabel(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
