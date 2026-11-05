import {it, expect} from 'vitest';
import type {NotificationInput} from '@lumin/contracts';
import {createStagingConfirmationDeliveryProvider} from './confirmation-delivery-provider';

const email: NotificationInput = {tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', channel: 'email', to: 'guest@example.test', template: 'booking_confirmed', variables: {body: 'hi'}};
const sms: NotificationInput = {tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', channel: 'sms', to: '+15551234567', template: 'booking_confirmed', variables: {body: 'hi'}};

it('acknowledges every send as sent', async () => {
  const provider = createStagingConfirmationDeliveryProvider();
  expect(await provider.send(email, 'k-email')).toEqual({kind: 'sent'});
  expect(await provider.send(sms, 'k-sms')).toEqual({kind: 'sent'});
});

it('is stateless: repeated identical sends still return sent', async () => {
  const provider = createStagingConfirmationDeliveryProvider();
  expect(await provider.send(email, 'k')).toEqual({kind: 'sent'});
  expect(await provider.send(email, 'k')).toEqual({kind: 'sent'});
});
