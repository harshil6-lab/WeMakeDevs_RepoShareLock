const providerEndpoint = "https://payments.example.com/v1/charges";

export type ProviderSettlement = {
  providerReference: string;
  settledAt: string;
};

/**
 * Calls the downstream payment provider.
 *
 * The provider applies its own retry policy and can take several seconds to
 * respond when it is under load, so callers must not keep a webhook request
 * open while waiting for this promise to settle.
 */
export async function chargeWithProvider(
  providerReference: string,
  amountCents: number,
): Promise<ProviderSettlement> {
  const response = await fetch(`${providerEndpoint}/${providerReference}`, {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });

  if (!response.ok) {
    throw new Error(`Payment provider rejected the charge: ${response.status}`);
  }

  return { providerReference, settledAt: new Date().toISOString() };
}
