import { formatMoney, money, type Selection, type Service, type ServiceQuestion } from "@lumin/contracts";
import { getService } from "../config/demoTenant";
import { useCheckout } from "../state/checkout";
import { validateSelection, type SelectionIssue } from "../state/validation";

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Accessible quantity stepper with real buttons and min/max enforcement. */
function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={`${label} quantity`}>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

function choiceHint(priceDelta: number, multiplierBp: number, currency: string): string {
  const parts: string[] = [];
  if (priceDelta > 0) parts.push(`+${formatMoney(money(priceDelta, currency))}`);
  if (priceDelta < 0) parts.push(`−${formatMoney(money(-priceDelta, currency))}`);
  if (multiplierBp !== 10000) parts.push(`×${multiplierBp / 10000}`);
  return parts.join(" ");
}

export function Configurator() {
  const { state, dispatch } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const selection = state.selection;

  if (!service || !selection) {
    return <p className="empty">Choose a service first.</p>;
  }

  const showErrors = state.attempted["configure"] === true;
  const issues: SelectionIssue[] = showErrors ? validateSelection(service, selection) : [];
  const issueFor = (id: string) => issues.find((i) => i.id === id)?.message;

  const update = (next: Selection) => dispatch({ type: "SET_SELECTION", selection: next });

  const setItemQty = (itemId: string, qty: number) =>
    update({ ...selection, itemQuantities: { ...selection.itemQuantities, [itemId]: qty } });

  const toggleAddon = (addonId: string) =>
    update({
      ...selection,
      addonIds: selection.addonIds.includes(addonId)
        ? selection.addonIds.filter((id) => id !== addonId)
        : [...selection.addonIds, addonId],
    });

  const setSingleChoice = (q: ServiceQuestion, choiceId: string) =>
    update({ ...selection, answers: { ...selection.answers, [q.id]: { choiceIds: [choiceId] } } });

  const toggleMultiChoice = (q: ServiceQuestion, choiceId: string) => {
    const current = selection.answers[q.id]?.choiceIds ?? [];
    const next = current.includes(choiceId)
      ? current.filter((id) => id !== choiceId)
      : [...current, choiceId];
    update({ ...selection, answers: { ...selection.answers, [q.id]: { choiceIds: next } } });
  };

  const setQuantityAnswer = (q: ServiceQuestion, qty: number) =>
    update({
      ...selection,
      answers: { ...selection.answers, [q.id]: { choiceIds: [], quantity: qty } },
    });

  const itemsError = issueFor("items");

  return (
    <section aria-labelledby="configure-heading">
      <h2 id="configure-heading">{service.name}</h2>
      {service.description && <p className="muted">{service.description}</p>}

      {service.items.length > 0 && (
        <fieldset
          className="config-group"
          aria-describedby={itemsError ? "err-items" : undefined}
        >
          <legend>What are we picking up?</legend>
          {service.items.map((item) => {
            const qty = selection.itemQuantities[item.id] ?? 0;
            return (
              <div key={item.id} className="config-row">
                <div className="config-row-text">
                  <span className="config-row-name">{item.name}</span>
                  {item.description && (
                    <span className="config-row-desc">{item.description}</span>
                  )}
                  <span className="config-row-price">
                    {formatMoney(money(item.unitPrice, service.currency))} each
                  </span>
                </div>
                <Stepper
                  label={item.name}
                  value={qty}
                  min={item.minQty}
                  max={item.maxQty}
                  onChange={(v) => setItemQty(item.id, v)}
                />
              </div>
            );
          })}
          {itemsError && (
            <p id="err-items" className="field-error">
              {itemsError}
            </p>
          )}
        </fieldset>
      )}

      {service.questions.map((q) => {
        const error = issueFor(q.id);
        const errorId = `err-${q.id}`;
        if (q.kind === "quantity") {
          const qty = selection.answers[q.id]?.quantity ?? (q.minQty ?? 0);
          return (
            <fieldset key={q.id} className="config-group" aria-describedby={error ? errorId : undefined}>
              <legend>{q.prompt}</legend>
              <div className="config-row">
                <div className="config-row-text">
                  {q.unitPrice != null && (
                    <span className="config-row-price">
                      {formatMoney(money(q.unitPrice, service.currency))} each
                    </span>
                  )}
                </div>
                <Stepper
                  label={q.prompt}
                  value={qty}
                  min={q.minQty ?? 0}
                  max={q.maxQty ?? 99}
                  onChange={(v) => setQuantityAnswer(q, v)}
                />
              </div>
              {error && (
                <p id={errorId} className="field-error">
                  {error}
                </p>
              )}
            </fieldset>
          );
        }
        const chosen = selection.answers[q.id]?.choiceIds ?? [];
        return (
          <fieldset key={q.id} className="config-group" aria-describedby={error ? errorId : undefined}>
            <legend>
              {q.prompt}
              {q.required && (
                <span className="required-mark" aria-hidden="true">
                  {" "}
                  *
                </span>
              )}
            </legend>
            {q.choices.map((choice) => {
              const inputId = `${q.id}-${choice.id}`;
              const hint = choiceHint(choice.priceDelta, choice.priceMultiplierBp, service.currency);
              return (
                <div key={choice.id} className="choice-row">
                  <input
                    id={inputId}
                    type={q.kind === "multi_choice" ? "checkbox" : "radio"}
                    name={q.id}
                    checked={chosen.includes(choice.id)}
                    onChange={() =>
                      q.kind === "multi_choice"
                        ? toggleMultiChoice(q, choice.id)
                        : setSingleChoice(q, choice.id)
                    }
                  />
                  <label htmlFor={inputId}>
                    {choice.label}
                    {hint && <span className="choice-hint"> {hint}</span>}
                  </label>
                </div>
              );
            })}
            {error && (
              <p id={errorId} className="field-error">
                {error}
              </p>
            )}
          </fieldset>
        );
      })}

      {service.addons.length > 0 && (
        <fieldset className="config-group">
          <legend>Add-ons</legend>
          {service.addons.map((addon) => {
            const inputId = `addon-input-${addon.id}`;
            return (
              <div key={addon.id} className="choice-row">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={selection.addonIds.includes(addon.id)}
                  onChange={() => toggleAddon(addon.id)}
                />
                <label htmlFor={inputId}>
                  {addon.name}
                  <span className="choice-hint">
                    {" "}
                    +{formatMoney(money(addon.price, service.currency))}
                  </span>
                  {addon.description && (
                    <span className="config-row-desc">{addon.description}</span>
                  )}
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}
