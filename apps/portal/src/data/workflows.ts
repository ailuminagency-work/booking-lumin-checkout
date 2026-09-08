/**
 * A @lumin/workflow config the CheckoutConfig page previews — the conditional
 * question flow a customer would experience. Pure, serializable data; it drives
 * the shared workflow engine and references an existing service's question ids.
 */
import type { WorkflowConfig } from "@lumin/workflow";

/** The seeded "Premium Detail Package" (configurable) service. */
export const PREVIEW_SERVICE_ID = "5e601001-0000-4000-a000-000000000002";

/** Its question id (see data/mockTenant demoServices). */
export const PREVIEW_QUESTION_ID = "q-size";

export const previewFlow: WorkflowConfig = {
  key: "detail-preview-flow",
  steps: [
    { key: "s-size", questionKey: PREVIEW_QUESTION_ID, required: true, title: "Vehicle size" },
    {
      key: "s-ceramic-reco",
      kind: "info",
      title: "Ceramic recommendation",
      recommend: {
        when: { field: PREVIEW_QUESTION_ID, op: "in", value: ["c-suv", "c-truck"] },
        text: "Recommend the ceramic top coat for larger vehicles.",
        addonKey: "ad-ceramic",
      },
    },
    {
      key: "s-truck-warn",
      kind: "warning",
      title: "Time warning",
      warn: {
        when: { field: PREVIEW_QUESTION_ID, op: "eq", value: "c-truck" },
        message: "Trucks and vans take longer — allow extra time at the slot.",
      },
    },
  ],
};
