import type {
  NotificationChannel,
  NotificationInput,
  NotificationProvider,
  NotificationSendResult,
  RenderedNotification,
  TemplateTrigger,
} from "@lumin/contracts";

/**
 * Idempotency + a fail-safe send path.
 *
 * A dedupe key is stable per (tenantId, bookingId, trigger, channel[, reminder])
 * so the same notification is never planned or sent twice. `sendNotifications`
 * sends only keys not already sent, dedupes WITHIN the batch, captures any
 * provider error PER ITEM (never throwing out of the batch), and never touches
 * booking state — a delivery failure cannot reverse a booking (Invariant R2).
 */

export interface DedupeKeyParts {
  tenantId: string;
  bookingId: string;
  trigger: TemplateTrigger;
  channel: NotificationChannel;
  reminderId?: string;
}

/** Stable dedupe key. Reminders add their rule id so each fires at most once. */
export function dedupeKey(parts: DedupeKeyParts): string {
  const base = `${parts.tenantId}:${parts.bookingId}:${parts.trigger}:${parts.channel}`;
  return parts.reminderId ? `${base}:${parts.reminderId}` : base;
}

/**
 * Map a rendered notification to the NotificationInput the provider sends. The
 * rendered subject/body ride along in `variables` so a provider that only knows
 * the fixed template ids still gets the final localized text.
 */
export function toNotificationInput(n: RenderedNotification): NotificationInput {
  const variables: Record<string, string> = { ...n.variables, body: n.body };
  if (n.subject !== undefined) variables.subject = n.subject;
  return {
    tenantId: n.tenantId,
    channel: n.channel,
    to: n.to,
    template: n.providerTemplate,
    variables,
  };
}

/**
 * Send every notification whose dedupe key is not already sent, exactly once.
 *
 * - Deduplicates against `alreadySent` AND within the batch itself.
 * - A provider error on one item is captured in `failed`; the rest still send.
 * - NEVER throws out of the batch, and NEVER mutates booking state.
 * - Successful keys are added to the (optionally caller-owned) sent set so a
 *   later batch skips them.
 */
export async function sendNotifications(
  provider: NotificationProvider,
  notifications: readonly RenderedNotification[],
  alreadySent: Set<string> = new Set<string>(),
): Promise<NotificationSendResult> {
  const result: NotificationSendResult = { sent: [], skipped: [], failed: [] };
  const seen = new Set<string>(alreadySent);

  for (const n of notifications) {
    if (seen.has(n.dedupeKey)) {
      result.skipped.push(n);
      continue;
    }
    try {
      const { messageId } = await provider.send(toNotificationInput(n));
      seen.add(n.dedupeKey);
      alreadySent.add(n.dedupeKey);
      result.sent.push({ ...n, messageId });
    } catch (err) {
      // Fail-safe: capture per item, do NOT mark sent, do NOT throw, do NOT
      // touch booking state. A retry can re-attempt this key next batch.
      result.failed.push({
        notification: n,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
