import { expect, it } from 'vitest';
import { FIELD_REGISTRY } from '../src/fieldRegistry';
it('lists exactly the approved nineteen kinds with honest new-contract capabilities', () => {
  expect(FIELD_REGISTRY.map(entry => entry.kind)).toEqual(['text', 'textarea', 'email', 'phone', 'number', 'quantity', 'dropdown', 'radio_cards', 'checkbox', 'date', 'time', 'date_range', 'address', 'postal_code', 'image_cards', 'resource_selector', 'file_photo', 'acknowledgement', 'terms']);
  expect(FIELD_REGISTRY.filter(entry => entry.contractSupported).map(entry => entry.kind)).toEqual(['text']);
  expect(FIELD_REGISTRY.every(entry => !entry.runtimePublishable && !entry.rendererSupported && !entry.persistenceSupported && Object.isFrozen(entry))).toBe(true);
  expect(Object.isFrozen(FIELD_REGISTRY)).toBe(true);
});
