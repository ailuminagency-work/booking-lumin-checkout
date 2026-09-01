import type { ChangeEvent } from "react";
import { useCheckout } from "../state/checkout";
import { validateCustomerDraft, type CustomerDraft } from "../state/validation";

interface FieldProps {
  id: keyof CustomerDraft & string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}

function Field({ id, label, value, error, onChange, type = "text", autoComplete, required }: FieldProps) {
  const errorId = `err-field-${id}`;
  return (
    <div className="form-field">
      <label htmlFor={`field-${id}`}>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <input
        id={`field-${id}`}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function CustomerForm() {
  const { state, dispatch } = useCheckout();
  const draft = state.customerDraft;
  const showErrors = state.attempted["customer"] === true;
  const issues = showErrors ? validateCustomerDraft(draft).issues : {};

  const patch = (p: Partial<CustomerDraft>) => dispatch({ type: "SET_CUSTOMER_DRAFT", patch: p });

  return (
    <section aria-labelledby="customer-heading">
      <h2 id="customer-heading">Your details</h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Field
          id="name"
          label="Full name"
          value={draft.name}
          error={issues["name"]}
          onChange={(v) => patch({ name: v })}
          autoComplete="name"
          required
        />
        <Field
          id="email"
          label="Email"
          value={draft.email}
          error={issues["email"]}
          onChange={(v) => patch({ email: v })}
          type="email"
          autoComplete="email"
          required
        />
        <Field
          id="phone"
          label="Phone (optional)"
          value={draft.phone}
          error={issues["phone"]}
          onChange={(v) => patch({ phone: v })}
          type="tel"
          autoComplete="tel"
        />

        <div className="form-field checkbox-field">
          <input
            id="field-wantsAddress"
            type="checkbox"
            checked={draft.wantsAddress}
            onChange={(e) => patch({ wantsAddress: e.target.checked })}
          />
          <label htmlFor="field-wantsAddress">This service happens at my address</label>
        </div>

        {draft.wantsAddress && (
          <fieldset className="config-group">
            <legend>Service address</legend>
            <Field
              id="line1"
              label="Street address"
              value={draft.line1}
              error={issues["line1"]}
              onChange={(v) => patch({ line1: v })}
              autoComplete="address-line1"
              required
            />
            <Field
              id="line2"
              label="Apt, suite, etc. (optional)"
              value={draft.line2}
              error={issues["line2"]}
              onChange={(v) => patch({ line2: v })}
              autoComplete="address-line2"
            />
            <Field
              id="city"
              label="City"
              value={draft.city}
              error={issues["city"]}
              onChange={(v) => patch({ city: v })}
              autoComplete="address-level2"
              required
            />
            <Field
              id="region"
              label="State / region (optional)"
              value={draft.region}
              error={issues["region"]}
              onChange={(v) => patch({ region: v })}
              autoComplete="address-level1"
            />
            <Field
              id="postalCode"
              label="Postal code (optional)"
              value={draft.postalCode}
              error={issues["postalCode"]}
              onChange={(v) => patch({ postalCode: v })}
              autoComplete="postal-code"
            />
            <Field
              id="country"
              label="Country (2-letter code)"
              value={draft.country}
              error={issues["country"]}
              onChange={(v) => patch({ country: v })}
              autoComplete="country"
              required
            />
          </fieldset>
        )}
      </form>
    </section>
  );
}
