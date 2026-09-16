/** Capabilities of this new contract only; existing V1/V2 behavior is unchanged.
 * Catalog support does not enable publication, rendering or persistence. */
const kinds = ['text', 'textarea', 'email', 'phone', 'number', 'quantity', 'dropdown', 'radio_cards', 'checkbox', 'date', 'time', 'date_range', 'address', 'postal_code', 'image_cards', 'resource_selector', 'file_photo', 'acknowledgement', 'terms'] as const;
export type FieldKind = typeof kinds[number];
export const FIELD_REGISTRY = Object.freeze(kinds.map(kind => Object.freeze({
  kind, contractSupported: kind === 'text', runtimePublishable: false as const,
  rendererSupported: false as const, persistenceSupported: false as const,
})));
