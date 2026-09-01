import { createPricingEngine } from "@lumin/core";
import { formatMoney, LuminError, type PriceBreakdown } from "@lumin/contracts";
import { getService } from "../config/demoTenant";
import { useCheckout } from "../state/checkout";

const pricingEngine = createPricingEngine();

/**
 * Live price summary. The breakdown is recomputed from the selection on EVERY
 * render by the shared pricing engine — no client-side totals are ever stored
 * (the server-side run of the same engine is the amount that gets charged).
 */
export function Summary() {
  const { state } = useCheckout();
  const service = getService(state.selection?.serviceId);

  if (!service || !state.selection) {
    return <p className="empty">Choose a service first.</p>;
  }

  let breakdown: PriceBreakdown | null = null;
  let error: string | null = null;
  try {
    breakdown = pricingEngine.price(service, state.selection);
  } catch (err) {
    error =
      err instanceof LuminError && err.code === "INVALID_SELECTION"
        ? "Your selections are incomplete. Go back and review your options."
        : "We couldn't price this selection. Go back and review your options.";
  }

  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading">Your order</h2>
      <p className="muted">{service.name}</p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {breakdown && (
        <div className="price-breakdown">
          <ul className="price-lines">
            {breakdown.lines.map((line, i) => (
              <li key={`${line.code}-${i}`} className="price-line">
                <span>
                  {line.label}
                  {line.quantity > 1 && <span className="muted"> × {line.quantity}</span>}
                </span>
                <span>{formatMoney(line.amount)}</span>
              </li>
            ))}
          </ul>
          <dl className="price-totals">
            <div className="price-total-row">
              <dt>Subtotal</dt>
              <dd data-testid="summary-subtotal">{formatMoney(breakdown.subtotal)}</dd>
            </div>
            <div className="price-total-row">
              <dt>Tax</dt>
              <dd data-testid="summary-tax">{formatMoney(breakdown.tax)}</dd>
            </div>
            {breakdown.deposit.amount > 0 && (
              <div className="price-total-row">
                <dt>Deposit</dt>
                <dd data-testid="summary-deposit">{formatMoney(breakdown.deposit)}</dd>
              </div>
            )}
            <div className="price-total-row grand">
              <dt>Total</dt>
              <dd data-testid="summary-total">{formatMoney(breakdown.total)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
