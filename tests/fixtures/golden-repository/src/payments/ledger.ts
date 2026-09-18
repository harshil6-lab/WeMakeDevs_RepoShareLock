export type SettlementRecord = {
  providerReference: string;
  settledAt: string;
};

const settlements = new Map<string, SettlementRecord>();

export async function recordSettlement(eventId: string, settlement: SettlementRecord) {
  settlements.set(eventId, settlement);
}

export function listSettlements(): SettlementRecord[] {
  return [...settlements.values()];
}
