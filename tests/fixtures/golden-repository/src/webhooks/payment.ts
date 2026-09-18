import { chargeWithProvider } from "../payments/provider";
import { recordSettlement } from "../payments/ledger";

export type WebhookRequest = {
  eventId: string;
  providerReference: string;
  amountCents: number;
};

/**
 * Handles payment provider webhook deliveries.
 *
 * The provider retries any delivery it does not receive an acknowledgement for,
 * so this handler must acknowledge quickly and must never hold the request open
 * on slow downstream work.
 */
export async function handlePaymentWebhook(request: WebhookRequest) {
  const settlement = await chargeWithProvider(request.providerReference, request.amountCents);
  await recordSettlement(request.eventId, settlement);

  return acknowledgeWebhook({ received: true, eventId: request.eventId });
}

export function acknowledgeWebhook(payload: { received: boolean; eventId: string }) {
  return { statusCode: 200, body: JSON.stringify(payload) };
}
