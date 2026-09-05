/**
 * @lumin/templates — configuration-driven service templates.
 *
 * The platform's generalization test: eight unrelated verticals expressed as
 * DATA + RULES over the existing service primitives. Each template is a pure
 * function from tenant context to a validated contracts `Service`; all of them
 * run on the SAME @lumin/core pricing, availability and booking engines with no
 * vertical branch anywhere. Adding a vertical means adding a template — the
 * engines never learn its name.
 */
export type { ServiceTemplate, TemplateBuildInput } from "./types";
export { X1 } from "./helpers";
export { templateRegistry, listTemplates, getTemplate } from "./registry";
export {
  allTemplates,
  junkRemoval,
  carDetailing,
  housekeeping,
  vehicleRental,
  equipmentRental,
  tentEventRental,
  pressureWashing,
  landscaping,
} from "./templates";
