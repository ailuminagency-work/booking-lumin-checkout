import { formatMoney, money } from "@lumin/contracts";
import { services } from "../config/demoTenant";
import { useCheckout } from "../state/checkout";

export function ServicePicker() {
  const { state, dispatch } = useCheckout();

  return (
    <section aria-labelledby="service-heading">
      <h2 id="service-heading">Choose a service</h2>
      <ul className="service-list">
        {services
          .filter((s) => s.active)
          .map((service) => {
            const selected = state.selection?.serviceId === service.id;
            return (
              <li key={service.id}>
                <button
                  type="button"
                  className={`service-card${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: "SELECT_SERVICE", service })}
                >
                  <span className="service-name">{service.name}</span>
                  <span className="service-desc">{service.description}</span>
                  <span className="service-price">
                    {service.basePrice > 0
                      ? `From ${formatMoney(money(service.basePrice, service.currency))}`
                      : "Priced by your selection"}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
