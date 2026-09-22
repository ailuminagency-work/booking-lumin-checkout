import { useEffect, useState } from "react";
import type { Slot } from "@lumin/contracts";
import { getService, policy, tenant } from "../config/demoTenant";
import { availabilityEngine, listExistingHolds } from "../engines";
import { dateKeyInTz } from "../lib/datetime";
import { display } from "../lib/i18n";
import { isResourceBacked, resourceStatusForSlot } from "../lib/resources";
import { overrides, rules } from "../config/demoTenant";
import { useCheckout } from "../state/checkout";

export function SlotPicker() {
  const { state, dispatch } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  // Stable "now" for resource-availability reads across this render session.
  const [nowIso] = useState(() => new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState<string | null>(
    state.slot ? dateKeyInTz(state.slot.start, tenant.timezone) : null,
  );
  const resourceBacked = service ? isResourceBacked(service.id) : false;

  useEffect(() => {
    if (!service) return;
    dispatch({ type: "SLOT_AVAILABILITY_PENDING", pending: true });
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

  useEffect(() => {
    if (slots === null || !service) return;
    if (state.slot) {
      const selected = slots.find(slot => slot.start === state.slot?.start && slot.end === state.slot?.end);
      const resourceAvailable = !resourceBacked || resourceStatusForSlot(service.id, state.slot, nowIso).satisfiable;
      if (!selected || !resourceAvailable) dispatch({ type: "CLEAR_SLOT" });
    }
    dispatch({ type: "SLOT_AVAILABILITY_PENDING", pending: false });
  }, [slots, state.slot, service, resourceBacked, nowIso, dispatch]);

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
      {resourceBacked && (
        <p className="muted" data-testid="slot-resource-hint">
          Some times are limited by resource availability.
        </p>
      )}
      <div className="date-strip" role="group" aria-label="Choose a date">
        {dateKeys.map((key) => {
          const first = byDate.get(key)?.[0];
          return (
            <button
              key={key}
              type="button"
              className={`chip${key === activeDate ? " selected" : ""}`}
              aria-pressed={key === activeDate}
              onClick={() => {
                setSelectedDate(key);
                if (state.slot && dateKeyInTz(state.slot.start, tenant.timezone) !== key) {
                  dispatch({ type: "CLEAR_SLOT" });
                }
              }}
            >
              {first ? display.dayLabel(first.start) : key}
            </button>
          );
        })}
      </div>
      <div className="slot-grid" role="group" aria-label="Choose a start time">
        {activeSlots.map((slot) => {
          const chosen = state.slot?.start === slot.start;
          const rstat = resourceBacked
            ? resourceStatusForSlot(service.id, { start: slot.start, end: slot.end }, nowIso)
            : null;
          const blocked = rstat != null && !rstat.satisfiable;
          return (
            <button
              key={slot.start}
              type="button"
              className={`slot-btn${chosen ? " selected" : ""}${blocked ? " unavailable" : ""}`}
              aria-pressed={chosen}
              disabled={blocked}
              title={
                rstat && rstat.resourceName
                  ? `${rstat.remaining}/${rstat.capacity} ${rstat.resourceName} available`
                  : undefined
              }
              onClick={() => dispatch({ type: "SET_SLOT", slot })}
            >
              {display.time(slot.start)}
              {rstat && rstat.resourceName && (
                <span className="slot-resource" aria-hidden="true">
                  {rstat.remaining}/{rstat.capacity}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {state.attempted.slot && !state.slot && <p role="alert">Please choose a time before continuing.</p>}
    </section>
  );
}
