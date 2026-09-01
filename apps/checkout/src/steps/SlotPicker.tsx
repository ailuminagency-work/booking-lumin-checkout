import { useEffect, useState } from "react";
import type { Slot } from "@lumin/contracts";
import { getService, policy, tenant } from "../config/demoTenant";
import { availabilityEngine, listExistingHolds } from "../engines";
import { dateKeyInTz, formatDayLabel, formatTime } from "../lib/datetime";
import { overrides, rules } from "../config/demoTenant";
import { useCheckout } from "../state/checkout";

export function SlotPicker() {
  const { state, dispatch } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    state.slot ? dateKeyInTz(state.slot.start, tenant.timezone) : null,
  );

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    setSlots(null);
    void (async () => {
      let result: Slot[] = [];
      try {
        const existing = await listExistingHolds();
        const nowIso = new Date().toISOString();
        result = availabilityEngine.getSlots({
          tenantTimezone: tenant.timezone,
          serviceId: service.id,
          durationMinutes: service.durationMinutes,
          policy,
          rules,
          overrides,
          existing,
          now: nowIso,
          from: nowIso,
          to: new Date(Date.now() + policy.horizonDays * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch {
        result = []; // fail closed: unprovable availability shows no times
      }
      if (!cancelled) {
        setSlots([...result].sort((a, b) => a.start.localeCompare(b.start)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service?.id]);

  if (!service) return <p className="empty">Choose a service first.</p>;

  if (slots === null) {
    return (
      <section aria-labelledby="slot-heading">
        <h2 id="slot-heading">Pick a time</h2>
        <p role="status" className="visually-hidden">
          Loading available times
        </p>
        <div className="skeleton-strip" aria-hidden="true">
          <div className="skeleton chip" />
          <div className="skeleton chip" />
          <div className="skeleton chip" />
          <div className="skeleton chip" />
        </div>
        <div className="skeleton-grid" aria-hidden="true">
          <div className="skeleton slot" />
          <div className="skeleton slot" />
          <div className="skeleton slot" />
          <div className="skeleton slot" />
          <div className="skeleton slot" />
          <div className="skeleton slot" />
        </div>
      </section>
    );
  }

  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dateKeyInTz(slot.start, tenant.timezone);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(slot);
    else byDate.set(key, [slot]);
  }
  const dateKeys = [...byDate.keys()];
  const activeDate =
    selectedDate && byDate.has(selectedDate) ? selectedDate : (dateKeys[0] ?? null);
  const activeSlots = activeDate ? (byDate.get(activeDate) ?? []) : [];

  if (dateKeys.length === 0) {
    return (
      <section aria-labelledby="slot-heading">
        <h2 id="slot-heading">Pick a time</h2>
        <p className="empty">No times available</p>
        <p className="muted">Please check back soon — new times open up regularly.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="slot-heading">
      <h2 id="slot-heading">Pick a time</h2>
      <p className="muted">
        Times shown in {tenant.timezone.replace("_", " ")} · {service.durationMinutes} min
      </p>
      <div className="date-strip" role="group" aria-label="Choose a date">
        {dateKeys.map((key) => {
          const first = byDate.get(key)?.[0];
          return (
            <button
              key={key}
              type="button"
              className={`chip${key === activeDate ? " selected" : ""}`}
              aria-pressed={key === activeDate}
              onClick={() => setSelectedDate(key)}
            >
              {first ? formatDayLabel(first.start, tenant.timezone) : key}
            </button>
          );
        })}
      </div>
      <div className="slot-grid" role="group" aria-label="Choose a start time">
        {activeSlots.map((slot) => {
          const chosen = state.slot?.start === slot.start;
          return (
            <button
              key={slot.start}
              type="button"
              className={`slot-btn${chosen ? " selected" : ""}`}
              aria-pressed={chosen}
              onClick={() => dispatch({ type: "SET_SLOT", slot })}
            >
              {formatTime(slot.start, tenant.timezone)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
