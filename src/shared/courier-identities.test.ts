import { describe, expect, it } from 'vitest';
import { collectDetectedCourierIdentities } from './courier-identities';
import type { Courier, ReportImport } from './types';

const courier = (overrides: Partial<Courier>): Courier => ({
  id: 'courier-1',
  name: 'Roby',
  phone: '+40 751 890 858',
  aliases: [],
  isActive: true,
  notes: '',
  createdAtIso: '2026-07-15T00:00:00.000Z',
  updatedAtIso: '2026-07-15T00:00:00.000Z',
  ...overrides,
});

const reportImport = (senders: string[]): ReportImport => ({
  id: 'import-1',
  reportId: 'report-1',
  role: 'restaurant',
  restaurantId: 'restaurant-1',
  sourceLabel: 'Michelino',
  importedAtIso: '2026-07-15T00:00:00.000Z',
  fileCount: 1,
  messageCount: senders.length,
  availabilityMessageCount: 0,
  issueCount: 0,
  importResult: {
    importedAtIso: '2026-07-15T00:00:00.000Z',
    files: [],
    issues: [],
    availabilityMessages: [],
    messages: senders.map((senderRaw, index) => ({
      id: `message-${index}`,
      sourceId: 'source-1',
      sourceFile: 'chat.txt',
      restaurantName: 'Michelino',
      lineNumber: index + 1,
      timestampIso: '2026-07-15T10:00:00.000Z',
      timestampMs: Date.parse('2026-07-15T10:00:00.000Z') + index,
      senderRaw,
      originalMessage: 'ridicat x1',
      status: 'ridicat',
      period: 'day',
      reportDayKey: '2026-07-15',
      quantity: 1,
      zoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
      outsideKilometers: 0,
      outsideAmountLei: 0,
      paidQuantity: 1,
      paidZoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
      paidOutsideZoneDeliveries: 0,
      paidOutsideKilometers: 0,
      paidOutsideAmountLei: 0,
      paidSource: 'pickup',
      note: '',
      confidence: 'high',
      needsReview: false,
      reviewReasons: [],
      rawLine: '',
    })),
  },
});

describe('collectDetectedCourierIdentities', () => {
  it('keeps a contact-name sender unassigned when only the courier phone is known', () => {
    const identities = collectDetectedCourierIdentities(
      [reportImport(['Robert 😊', 'Robert 😊'])],
      [courier({})],
    );

    expect(identities).toEqual([
      expect.objectContaining({
        rawIdentity: 'Robert 😊',
        messageCount: 2,
        mappedCourierId: null,
      }),
    ]);
  });

  it('maps deterministic phone formats and exact saved text aliases', () => {
    const identities = collectDetectedCourierIdentities(
      [reportImport(['0751 890 858', 'Robert 😊'])],
      [courier({ aliases: ['Robert 😊'] })],
    );

    expect(identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawIdentity: '0751 890 858', mappedCourierName: 'Roby' }),
      expect.objectContaining({ rawIdentity: 'Robert 😊', mappedCourierName: 'Roby' }),
    ]));
  });

  it('does not fuzzy-match similar names', () => {
    const identities = collectDetectedCourierIdentities(
      [reportImport(['Ion Popescu.'])],
      [courier({ name: 'Ion Popescu', phone: '', aliases: ['Ion Popescu'] })],
    );

    expect(identities[0].mappedCourierId).toBeNull();
  });
});
