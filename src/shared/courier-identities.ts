import { normalizeCourierIdentity } from './parser';
import type { Courier, ReportImport } from './types';

export interface DetectedCourierIdentity {
  rawIdentity: string;
  normalizedIdentity: string;
  messageCount: number;
  mappedCourierId: string | null;
  mappedCourierName: string | null;
}

export function collectDetectedCourierIdentities(
  imports: ReportImport[],
  couriers: Courier[],
): DetectedCourierIdentity[] {
  const owners = new Map<string, Courier>();
  for (const courier of couriers) {
    for (const identity of [courier.phone, ...courier.aliases]) {
      const normalized = normalizeCourierIdentity(identity);
      if (normalized) owners.set(normalized, courier);
    }
  }

  const detected = new Map<string, { rawIdentity: string; messageIds: Set<string> }>();
  for (const reportImport of imports) {
    const messages = [
      ...reportImport.importResult.messages,
      ...reportImport.importResult.availabilityMessages,
    ];
    for (const message of messages) {
      const rawIdentity = message.senderRaw.trim();
      const normalizedIdentity = normalizeCourierIdentity(rawIdentity);
      if (!rawIdentity || !normalizedIdentity) continue;

      const current = detected.get(normalizedIdentity) ?? {
        rawIdentity,
        messageIds: new Set<string>(),
      };
      current.messageIds.add(message.id);
      detected.set(normalizedIdentity, current);
    }
  }

  return Array.from(detected.entries())
    .map(([normalizedIdentity, value]) => {
      const owner = owners.get(normalizedIdentity);
      return {
        rawIdentity: value.rawIdentity,
        normalizedIdentity,
        messageCount: value.messageIds.size,
        mappedCourierId: owner?.id ?? null,
        mappedCourierName: owner?.name ?? null,
      };
    })
    .sort((left, right) => (
      Number(Boolean(left.mappedCourierId)) - Number(Boolean(right.mappedCourierId))
      || right.messageCount - left.messageCount
      || left.rawIdentity.localeCompare(right.rawIdentity, 'ro-RO')
    ));
}
