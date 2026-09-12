import { types } from 'node:util';
const isProxy = types.isProxy;
const descriptor = Object.getOwnPropertyDescriptor;
export const HOSTED_FAILURE_PHASES = Object.freeze([
  'UNKNOWN', 'HOSTED_SETUP',
  ...['ONE', 'TWO'].flatMap(version => ['INITIAL_READY', 'SHAPE', 'HEADERS', 'BOOTSTRAP', 'FRAME_DENIAL', 'RETURN_READY', 'SNAPSHOT'].map(stage => 'HOSTED_V_' + version + '_' + stage)),
  'HOSTED_CAPTURE', 'HOSTED_FINAL_SNAPSHOT',
]);
const messages = new Map(HOSTED_FAILURE_PHASES.filter(phase => phase !== 'UNKNOWN').map(phase => ['SAFE_RUNTIME_ASSERTION_FAILED_' + phase, phase]));
/** Project only one exact fixed error literal; never invoke payload accessors or proxy traps. */
export function hostedFailurePhase(errors) {
  if (isProxy(errors) || !Array.isArray(errors)) return 'UNKNOWN';
  const length = descriptor(errors, 'length');
  if (!length || length.value !== 1) return 'UNKNOWN';
  const entry = descriptor(errors, '0');
  if (!entry || !('value' in entry)) return 'UNKNOWN';
  const error = entry.value;
  if (!error || typeof error !== 'object' || isProxy(error)) return 'UNKNOWN';
  const message = descriptor(error, 'message');
  if (!message || !('value' in message) || typeof message.value !== 'string' || message.value.length > 100) return 'UNKNOWN';
  return messages.get(message.value) ?? 'UNKNOWN';
}
