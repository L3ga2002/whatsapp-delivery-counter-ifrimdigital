import { describe, expect, it } from 'vitest';
import {
  applyRestaurantScheduleTariff,
  buildScanReport,
  filterMessagesForRestaurantSchedule,
  normalizeCourierIdentity,
  parseImportedTexts,
  parseWhatsAppExport,
  resolveCourierName,
} from './parser';

describe('WhatsApp export parser', () => {
  it('matches Romanian courier phone aliases across common WhatsApp formats', () => {
    const aliases = { '0745 123 456': 'Robert Ifrim' };

    expect(resolveCourierName('+40 745 123 456', aliases)).toBe('Robert Ifrim');
    expect(resolveCourierName('0040 745-123-456', aliases)).toBe('Robert Ifrim');
    expect(resolveCourierName('745123456', aliases)).toBe('Robert Ifrim');
    expect(normalizeCourierIdentity('0745 123 456')).toBe('phone:40745123456');
  });

  it('matches courier text aliases without depending on case or repeated spaces', () => {
    expect(resolveCourierName('  ROBERT   Delivery  ', { 'Robert Delivery': 'Robert Ifrim' })).toBe('Robert Ifrim');
  });

  it('parses Romanian WhatsApp delivery lines with statuses, quantities, and notes', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - +40 721 000 111: ridicat x2',
        '30.05.2026, 21:22 - Mihai Curier: Livrat X1 zona 2 <Acest mesaj a fost editat>',
        '30.05.2026, 21:25 - Restaurant: E gata',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.issues).toHaveLength(0);
    expect(parsed.conversationLines).toHaveLength(3);
    expect(parsed.conversationLines[2]).toMatchObject({
      senderRaw: 'Restaurant',
      message: 'E gata',
      isSystemLine: false,
    });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      senderRaw: '+40 721 000 111',
      status: 'ridicat',
      quantity: 2,
      needsReview: false,
    });
    expect(parsed.messages[1]).toMatchObject({
      senderRaw: 'Mihai Curier',
      restaurantName: 'chat',
      status: 'livrat',
      quantity: 1,
      zoneCounts: {
        zone1: 0,
        zone2: 1,
        zone3: 0,
      },
      note: '',
      needsReview: true,
    });
  });

  it('keeps multiline WhatsApp messages attached to the original export entry', () => {
    const parsed = parseWhatsAppExport(
      ['30.05.2026, 21:14 - Ana: livrat x1', 'zona 2', 'completare comanda'].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].originalMessage).toContain('zona 2');
    expect(parsed.messages[0].zoneCounts.zone2).toBe(1);
    expect(parsed.messages[0].note).toBe('completare comanda');
  });

  it('counts missing quantities as one and flags them for review', () => {
    const parsed = parseWhatsAppExport('30.05.2026, 21:14 - Ana: ridicat', 'chat.txt');

    expect(parsed.messages[0]).toMatchObject({
      quantity: 1,
      confidence: 'medium',
      needsReview: true,
    });
  });

  it('does not count conversational questions or negations that mention a status', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Admin: George ai livrat?',
        '30.05.2026, 21:20 - Admin: Pune o poza cu bonul daca nu ai livrat',
        '30.05.2026, 21:30 - Ana: Livrat',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      senderRaw: 'Ana',
      status: 'livrat',
      quantity: 1,
      needsReview: true,
    });
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'info',
          message: 'Status mentionat intr-o intrebare sau conversatie; nu a fost numarat ca livrare/ridicare.',
        }),
      ]),
    );
  });

  it('counts close human typos for delivery statuses and flags them for review', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: riricat x1',
        '30.05.2026, 21:20 - Ana: livrt x1 zona 2',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      status: 'ridicat',
      quantity: 1,
      confidence: 'medium',
      needsReview: true,
    });
    expect(parsed.messages[0].reviewReasons[0]).toContain('Status corectat automat');
    expect(parsed.messages[1]).toMatchObject({
      status: 'livrat',
      quantity: 1,
      zoneCounts: {
        zone1: 0,
        zone2: 1,
        zone3: 0,
      },
      needsReview: true,
    });
  });

  it('counts real-world status variants from WhatsApp exports and flags them for review', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 18:00 - Ana: Preluat X1',
        '30.05.2026, 18:10 - Ana: Livrați X1',
        '30.05.2026, 18:20 - Ana: Ridica X1',
        '30.05.2026, 18:30 - Ana: Riscat x1',
        '30.05.2026, 18:40 - Ana: Luat',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(5);
    expect(parsed.messages.map((message) => message.status)).toEqual([
      'ridicat',
      'livrat',
      'ridicat',
      'ridicat',
      'ridicat',
    ]);
    expect(parsed.messages.every((message) => message.needsReview)).toBe(true);
  });

  it('counts real-world implicit quantities near clear courier actions', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 18:00 - Ana: Ridicat. 1',
        '30.05.2026, 18:20 - Ana: Am ridicat doar una',
        '30.05.2026, 18:40 - Ana: livrat doua',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0]).toMatchObject({
      status: 'ridicat',
      quantity: 1,
      needsReview: true,
    });
    expect(parsed.messages[0].reviewReasons.join(' ')).toContain('numar simplu');
    expect(parsed.messages[1]).toMatchObject({
      status: 'ridicat',
      quantity: 1,
      needsReview: true,
    });
    expect(parsed.messages[2]).toMatchObject({
      status: 'livrat',
      quantity: 2,
      needsReview: true,
    });
  });

  it('does not treat time/place words as delivery quantities', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 18:00 - Ana: Ridicat la ora doua',
        '30.05.2026, 18:20 - Ana: Am ridicat la ora doua',
        '30.05.2026, 18:40 - Ana: livrat la doi pasi',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(0);
  });

  it('does not fuzzy-count unrelated words without delivery quantity or zone context', () => {
    const parsed = parseWhatsAppExport('30.05.2026, 21:14 - Ana: licrat comanda', 'chat.txt');

    expect(parsed.messages).toHaveLength(0);
  });

  it('tracks delivery zones separately from delivery totals', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: livrat x1 zona 2',
        '30.05.2026, 21:20 - Ana: Livrat x2 (x1 zona 2 + x1 completare comanda)',
        '30.05.2026, 21:25 - Ana: ridicat x1 zona 2',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages[0].zoneCounts.zone2).toBe(1);
    expect(parsed.messages[1]).toMatchObject({
      status: 'livrat',
      quantity: 2,
      zoneCounts: {
        zone1: 0,
        zone2: 1,
        zone3: 0,
      },
    });
    expect(parsed.messages[2]).toMatchObject({
      status: 'ridicat',
      zoneCounts: {
        zone1: 0,
        zone2: 0,
        zone3: 0,
      },
    });
  });

  it('detects reversed quantity syntax before zones', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 21:14 - Ana: livrat 1x zona 3',
      'chat.txt',
    );

    expect(parsed.messages[0]).toMatchObject({
      quantity: 1,
      zoneCounts: {
        zone1: 0,
        zone2: 0,
        zone3: 1,
      },
    });
  });

  it('detects restaurant names and outside kilometers', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 21:14 - Ana: livrat x1 7 km',
      'Conversație WhatsApp cu Mastro Pizza Delivery🍕.txt',
    );

    expect(parsed.restaurantName).toBe('Mastro Pizza Delivery');
    expect(parsed.messages[0]).toMatchObject({
      restaurantName: 'Mastro Pizza Delivery',
      outsideKilometers: 7,
    });
  });

  it('treats zones above three as outside-zone review context', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 21:14 - Ana: livrat x1 zona 4 6km',
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    expect(parsed.messages[0]).toMatchObject({
      zoneCounts: {
        zone1: 0,
        zone2: 0,
        zone3: 0,
      },
      outsideKilometers: 6,
      needsReview: true,
    });
    expect(parsed.messages[0].reviewReasons.join(' ')).toContain('zona peste 3');
  });

  it('detects informal lei amounts on delivered messages for review', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: livrat 45 lei',
        '30.05.2026, 21:22 - Ana: livrat (55lei)',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      status: 'livrat',
      quantity: 1,
      outsideAmountLei: 45,
      paidQuantity: 0,
      needsReview: true,
    });
    expect(parsed.messages[1]).toMatchObject({
      outsideAmountLei: 55,
      needsReview: true,
    });

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0].outsideAmountLei).toBe(0);
    expect(report.restaurantSummaries[0].outsideAmountLei).toBe(0);
    expect(report.dailyCourierSummaries[0].outsideAmountLei).toBe(0);
    expect(report.totalOutsideAmountLei).toBe(0);
  });

  it('classifies paid pickup zones, outside lei, returns, and completions from ridicat messages', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Ridicat x2 (1 x zona 2)',
        '30.05.2026, 10:10 - Ana: Ridicat x3 (1x zona 3, 1x zona 2)',
        '30.05.2026, 10:20 - Ana: Ridicat 45 lei',
        '30.05.2026, 10:30 - Ana: Ridicat x1 (48 lei)',
        '30.05.2026, 10:35 - Ana: Ridicat x2 (1 x zona 2 + 45 lei)',
        '30.05.2026, 10:40 - Ana: Retur',
        '30.05.2026, 10:50 - Ana: Anulata (retur)',
        '30.05.2026, 11:00 - Ana: Anulat',
        '30.05.2026, 11:10 - Ana: Ridicat completare',
        '30.05.2026, 11:20 - Ana: Ridicat x2 (1 x completare)',
        '30.05.2026, 11:30 - Ana: Ridicat zona 2',
        '30.05.2026, 11:40 - Ana: Completare x1',
        '30.05.2026, 11:50 - Ana: Completare comanda',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    expect(parsed.messages).toHaveLength(12);
    expect(parsed.messages[0]).toMatchObject({
      paidQuantity: 2,
      paidZoneCounts: { zone1: 1, zone2: 1, zone3: 0 },
    });
    expect(parsed.messages[1]).toMatchObject({
      paidQuantity: 3,
      paidZoneCounts: { zone1: 1, zone2: 1, zone3: 1 },
    });
    expect(parsed.messages[2]).toMatchObject({
      paidQuantity: 1,
      paidOutsideZoneDeliveries: 1,
      paidOutsideAmountLei: 45,
    });
    expect(parsed.messages[3]).toMatchObject({
      paidQuantity: 1,
      paidOutsideZoneDeliveries: 1,
      paidOutsideAmountLei: 48,
    });
    expect(parsed.messages[4]).toMatchObject({
      paidQuantity: 2,
      paidZoneCounts: { zone1: 0, zone2: 1, zone3: 0 },
      paidOutsideZoneDeliveries: 1,
      paidOutsideAmountLei: 45,
    });
    expect(parsed.messages[5]).toMatchObject({
      paidSource: 'return',
      paidQuantity: 1,
      paidZoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
    });
    expect(parsed.messages[6]).toMatchObject({
      paidSource: 'return',
      paidQuantity: 1,
    });
    expect(parsed.messages[7]).toMatchObject({
      paidSource: 'completion',
      paidQuantity: 1,
      paidZoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
    });
    expect(parsed.messages[8]).toMatchObject({
      paidSource: 'completion',
      paidQuantity: 2,
      paidZoneCounts: { zone1: 2, zone2: 0, zone3: 0 },
    });
    expect(parsed.messages[9]).toMatchObject({
      paidQuantity: 1,
      paidZoneCounts: { zone1: 0, zone2: 1, zone3: 0 },
    });
    expect(parsed.messages[10]).toMatchObject({
      paidSource: 'completion',
      paidQuantity: 1,
      paidZoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
      needsReview: true,
    });
    expect(parsed.messages[11]).toMatchObject({
      paidSource: 'completion',
      paidQuantity: 1,
      paidZoneCounts: { zone1: 1, zone2: 0, zone3: 0 },
      needsReview: true,
    });
  });

  it('counts glued quantities and multiple addresses conservatively', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Ridicatx1',
        '30.05.2026, 10:10 - Ana: Ridicat Tazlaului si Mioritei',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      status: 'ridicat',
      quantity: 1,
      paidQuantity: 1,
      needsReview: true,
    });
    expect(parsed.messages[1]).toMatchObject({
      quantity: 2,
      paidQuantity: 2,
      paidZoneCounts: { zone1: 2, zone2: 0, zone3: 0 },
      needsReview: true,
    });
  });

  it('uses delivered zone to complete an implicit paid pickup without double counting', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Ridicat x1',
        '30.05.2026, 10:20 - Ana: Livrat x1 zona 2',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 23, 59, 59).toISOString(),
      },
      {},
    );

    expect(report.totalPickedUp).toBe(1);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
    expect(report.totalOutsideZoneDeliveries).toBe(0);
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        reason: expect.stringContaining('Zona/exterior completata din mesajul livrat'),
      }),
    );
  });

  it('uses delivered lei amount to complete an implicit paid pickup as outside delivery', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Ridicat x1',
        '30.05.2026, 10:20 - Ana: Livrat x1 45 lei',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 23, 59, 59).toISOString(),
      },
      {},
    );

    expect(report.totalPickedUp).toBe(1);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 0, zone3: 0 });
    expect(report.totalOutsideZoneDeliveries).toBe(1);
    expect(report.totalOutsideAmountLei).toBe(45);
  });

  it('keeps explicit pickup classification when delivered classification conflicts', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Ridicat x1 zona 2',
        '30.05.2026, 10:20 - Ana: Livrat x1 zona 3',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 23, 59, 59).toISOString(),
      },
      {},
    );

    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'mismatch',
        reason: expect.stringContaining('contrazice ridicarea explicita'),
      }),
    );
  });

  it('keeps day or night tariff bucket based on pickup time when delivery completes the zone', () => {
    const dayParsed = parseWhatsAppExport(
      [
        '30.05.2026, 22:50 - Ana: Ridicat x1',
        '30.05.2026, 23:20 - Ana: Livrat x1 zona 2',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const nightParsed = parseWhatsAppExport(
      [
        '30.05.2026, 23:10 - Ana: Ridicat x1',
        '30.05.2026, 23:30 - Ana: Livrat x1 zona 3',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    const dayReport = buildScanReport(
      dayParsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 31, 3, 59, 59).toISOString(),
      },
      {},
    );
    const nightReport = buildScanReport(
      nightParsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 31, 3, 59, 59).toISOString(),
      },
      {},
    );

    expect(dayReport.totalPickedUp).toBe(1);
    expect(dayReport.totalNightPickedUp).toBe(0);
    expect(dayReport.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
    expect(nightReport.totalPickedUp).toBe(0);
    expect(nightReport.totalNightPickedUp).toBe(1);
    expect(nightReport.totalNightZoneCounts).toEqual({ zone1: 0, zone2: 0, zone3: 1 });
  });

  it('uses lei amounts as context for conservative fuzzy status correction', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 21:14 - Ana: livrt 45 lei',
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    expect(parsed.messages[0]).toMatchObject({
      status: 'livrat',
      quantity: 1,
      outsideAmountLei: 45,
      needsReview: true,
    });
    expect(parsed.messages[0].reviewReasons.join(' ')).toContain('Status corectat automat');
  });

  it('reports relevant messages without senders instead of counting them', () => {
    const parsed = parseWhatsAppExport('30.05.2026, 21:14 - livrat x1', 'chat.txt');

    expect(parsed.messages).toHaveLength(0);
    expect(parsed.issues[0]).toMatchObject({
      severity: 'warning',
      message: 'Relevant delivery status found, but sender is missing.',
    });
  });

  it('aggregates multiple imported text files', () => {
    const result = parseImportedTexts([
      { sourceFile: 'a.txt', text: '30.05.2026, 21:14 - Ana: ridicat x1', bytes: 40 },
      { sourceFile: 'b.txt', text: '30.05.2026, 21:20 - Ana: livrat x1', bytes: 40 },
    ]);

    expect(result.files).toHaveLength(2);
    expect(result.messages).toHaveLength(2);
  });

  it('parses availability messages separately from delivery messages', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Disponibil',
        '30.05.2026, 12:15 - Ana: Indisponibil',
      ].join('\n'),
      'chat.txt',
    );

    expect(parsed.messages).toHaveLength(0);
    expect(parsed.sourceKind).toBe('availability');
    expect(parsed.availabilityMessages).toHaveLength(2);
    expect(parsed.availabilityMessages.map((message) => message.status)).toEqual([
      'disponibil',
      'indisponibil',
    ]);
  });

  it('classifies imported restaurant and work-hours groups separately', () => {
    const result = parseImportedTexts([
      {
        sourceFile: 'Conversație WhatsApp cu Restaurant Test.txt',
        text: [
          '30.05.2026, 10:00 - Ana: ridicat x1',
          '30.05.2026, 10:15 - Ana: livrat x1',
          '30.05.2026, 10:20 - Ana: disponibil pentru discutii',
        ].join('\n'),
        bytes: 120,
      },
      {
        sourceFile: 'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
        text: [
          '30.05.2026, 09:00 - Ana: Disponibil',
          '30.05.2026, 17:00 - Ana: Indisponibil',
        ].join('\n'),
        bytes: 90,
      },
    ]);

    expect(result.files.map((file) => file.sourceKind)).toEqual(['restaurant', 'availability']);
    expect(result.messages).toHaveLength(2);
    expect(result.availabilityMessages).toHaveLength(3);
  });
});

describe('scan report builder', () => {
  it('uses an explicitly saved contact-name alias with emoji in app and export data', () => {
    const parsed = parseWhatsAppExport(
      [
        '15.07.2026, 10:00 - Robert 😊: ridicat x1',
        '15.07.2026, 10:12 - Robert 😊: livrat x1',
      ].join('\n'),
      'Michelino.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 6, 15, 9, 0).toISOString(),
        toIso: new Date(2026, 6, 15, 11, 0).toISOString(),
      },
      { 'Robert 😊': 'Roby' },
    );

    expect(report.summaries).toHaveLength(1);
    expect(report.summaries[0]).toMatchObject({
      displayName: 'Roby',
      senderAliases: ['Robert 😊'],
      pickedUp: 1,
      delivered: 1,
    });
    expect(report.dailyCourierSummaries[0].courierName).toBe('Roby');
  });

  it('uses inclusive selected interval boundaries and alias display names', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - +40721000111: ridicat x1',
        '30.05.2026, 21:22 - +40721000111: livrat x1',
        '30.05.2026, 21:23 - +40721000111: livrat x1',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 14).toISOString(),
        toIso: new Date(2026, 4, 30, 21, 22).toISOString(),
      },
      { '+40721000111': 'Alex Curier' },
    );

    expect(report.totalMessagesInInterval).toBe(2);
    expect(report.summaries[0]).toMatchObject({
      displayName: 'Alex Curier',
      pickedUp: 1,
      delivered: 1,
      zoneCounts: {
        zone1: 1,
        zone2: 0,
        zone3: 0,
      },
      outsideKilometers: 0,
      deliveredWithoutZone: 0,
      difference: 0,
    });
    expect(report.restaurantSummaries[0]).toMatchObject({
      restaurantName: 'chat',
      pickedUp: 1,
      delivered: 1,
      courierCount: 1,
    });
  });

  it('normalizes legacy saved imports missing paid-order fields before scanning', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: ridicat x1 zona 2',
        '30.05.2026, 21:30 - Ana: livrat x1',
      ].join('\n'),
      'chat.txt',
    );
    const legacyMessages = parsed.messages.map((message) => {
      const legacyMessage = { ...message } as Record<string, unknown>;
      delete legacyMessage.paidQuantity;
      delete legacyMessage.paidZoneCounts;
      delete legacyMessage.paidOutsideZoneDeliveries;
      delete legacyMessage.paidOutsideKilometers;
      delete legacyMessage.paidOutsideAmountLei;
      delete legacyMessage.paidSource;
      return legacyMessage as unknown as (typeof parsed.messages)[number];
    });

    const report = buildScanReport(
      legacyMessages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0]).toMatchObject({
      displayName: 'Ana',
      pickedUp: 1,
      delivered: 1,
      zoneCounts: { zone1: 0, zone2: 1, zone3: 0 },
      difference: 0,
    });
    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        courierName: 'Ana',
        reason: expect.stringContaining('Import vechi normalizat automat'),
      }),
    );
  });

  it('normalizes legacy saved imports with missing timestampMs before interval filtering', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 10:00 - Ana: Ridicat x1 zona 2',
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const legacyMessage = { ...parsed.messages[0] } as Partial<typeof parsed.messages[number]>;
    delete legacyMessage.timestampMs;

    const report = buildScanReport(
      [legacyMessage as typeof parsed.messages[number]],
      {
        fromIso: new Date(2026, 4, 30, 0, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 23, 59, 59).toISOString(),
      },
      {},
    );

    expect(report.totalPickedUp).toBe(1);
    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
  });

  it('aggregates paid zone counts by courier from ridicat messages', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: livrat x1 zona 2',
        '30.05.2026, 21:20 - Ana: Livrat x2 (x1 zona 2 + x1 completare comanda)',
        '30.05.2026, 21:22 - Ana: livrat x1 zona 3',
        '30.05.2026, 21:30 - Ana: ridicat x1 zona 2',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0]).toMatchObject({
      delivered: 4,
        zoneCounts: {
          zone1: 0,
          zone2: 1,
          zone3: 0,
        },
      deliveredWithoutZone: 0,
    });
    expect(report.totalZoneCounts).toEqual({
      zone1: 0,
      zone2: 1,
      zone3: 0,
    });
    expect(report.totalDeliveredWithoutZone).toBe(0);
  });

  it('pairs picked-up and delivered messages to calculate average delivery time', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: ridicat x1',
        '30.05.2026, 10:25 - Ana: livrat x1',
        '30.05.2026, 11:00 - Ana: ridicat x2',
        '30.05.2026, 11:20 - Ana: livrat x1',
        '30.05.2026, 11:50 - Ana: livrat x1',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 9, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 12, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0]).toMatchObject({
      displayName: 'Ana',
      pickedUp: 3,
      delivered: 3,
      deliveryTimeSampleCount: 3,
      averageDeliveryMinutes: 31.7,
      medianDeliveryMinutes: 25,
    });
    expect(report.restaurantSummaries[0]).toMatchObject({
      restaurantName: 'Restaurant Test',
      deliveryTimeSampleCount: 3,
      averageDeliveryMinutes: 31.7,
      medianDeliveryMinutes: 25,
    });
    expect(report.dailyCourierSummaries[0]).toMatchObject({
      restaurantName: 'Restaurant Test',
      courierName: 'Ana',
      pickedUp: 3,
      delivered: 3,
      deliveryTimeSampleCount: 3,
      averageDeliveryMinutes: 31.7,
      medianDeliveryMinutes: 25,
    });
  });

  it('excludes unrealistic delivery-time pairs from the average and keeps the next valid pickup', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: ridicat x1',
        '30.05.2026, 17:00 - Ana: ridicat x1',
        '30.05.2026, 17:20 - Ana: livrat x1',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 8, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 18, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0]).toMatchObject({
      displayName: 'Ana',
      deliveryTimeSampleCount: 1,
      averageDeliveryMinutes: 20,
    });
    expect(report.reviewRows.some((row) => row.kind === 'mismatch' && row.reason.includes('exclusa din media de livrare'))).toBe(true);
  });

  it('keeps night deliveries out of day totals and reports 00-04 on the previous day', () => {
    const parsed = parseWhatsAppExport(
      [
        '09.05.2026, 22:50 - Ana: ridicat x1',
        '09.05.2026, 22:58 - Ana: livrat x1 zona 1',
        '09.05.2026, 23:10 - Ana: ridicat x1',
        '09.05.2026, 23:20 - Ana: livrat x1 zona 2',
        '10.05.2026, 00:10 - Ana: ridicat x1',
        '10.05.2026, 00:30 - Ana: livrat x1 zona 3',
        '10.05.2026, 00:40 - Ana: ridicat x1',
        '10.05.2026, 00:50 - Ana: livrat x1 25 lei',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 9, 22, 0).toISOString(),
        toIso: new Date(2026, 4, 10, 1, 0).toISOString(),
      },
      {},
    );

    expect(report.totalDelivered).toBe(1);
    expect(report.totalNightDelivered).toBe(3);
    expect(report.totalZoneCounts).toEqual({ zone1: 1, zone2: 0, zone3: 0 });
    expect(report.totalNightZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 1 });
    expect(report.totalNightOutsideZoneDeliveries).toBe(1);
    expect(report.totalNightOutsideAmountLei).toBe(25);
    expect(report.dailyCourierSummaries[0]).toMatchObject({
      dayKey: '2026-05-09',
      delivered: 1,
      nightDelivered: 3,
      nightOutsideZoneDeliveries: 1,
      nightOutsideAmountLei: 25,
    });
  });

  it('keeps tariff bucket on pickup time even when delivery is after 23:00', () => {
    const parsed = parseWhatsAppExport(
      [
        '09.05.2026, 22:50 - Ana: ridicat x1 zona 2',
        '09.05.2026, 23:20 - Ana: livrat x1',
        '09.05.2026, 23:10 - Ana: ridicat x1 zona 3',
        '09.05.2026, 23:30 - Ana: livrat x1',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 9, 22, 0).toISOString(),
        toIso: new Date(2026, 4, 10, 0, 0).toISOString(),
      },
      {},
    );

    expect(report.totalPickedUp).toBe(1);
    expect(report.totalNightPickedUp).toBe(1);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalNightDelivered).toBe(1);
    expect(report.totalZoneCounts).toEqual({ zone1: 0, zone2: 1, zone3: 0 });
    expect(report.totalNightZoneCounts).toEqual({ zone1: 0, zone2: 0, zone3: 1 });
    expect(report.summaries[0]).toMatchObject({
      delivered: 1,
      nightDelivered: 1,
      difference: 0,
      nightDifference: 0,
    });
  });

  it('reports night mismatches separately when night pickups and deliveries differ', () => {
    const parsed = parseWhatsAppExport(
      [
        '09.05.2026, 23:10 - Ana: ridicat x2',
        '09.05.2026, 23:30 - Ana: livrat x1',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 9, 23, 0).toISOString(),
        toIso: new Date(2026, 4, 10, 1, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0]).toMatchObject({
      difference: 0,
      nightDifference: 1,
    });
    expect(
      report.reviewRows.some((row) => row.kind === 'mismatch' && row.id.startsWith('mismatch-night-')),
    ).toBe(true);
  });

  it('calculates work hours from a separate availability group without adding them to restaurants', () => {
    const restaurant = parseWhatsAppExport(
      [
        '30.05.2026, 10:10 - Ana: ridicat x1',
        '30.05.2026, 10:25 - Ana: livrat x1',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: Disponibil',
        '30.05.2026, 10:30 - Ion: Indisponibil',
        '30.05.2026, 12:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
    );

    const report = buildScanReport(
      restaurant.messages,
      {
        fromIso: new Date(2026, 4, 30, 9, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 13, 0).toISOString(),
      },
      {},
      availability.availabilityMessages,
    );

    expect(report.summaries.find((summary) => summary.displayName === 'Ana')).toMatchObject({
      workMinutes: 120,
      workSessionCount: 1,
    });
    expect(report.restaurantSummaries[0]).toMatchObject({
      restaurantName: 'Restaurant Test',
      workMinutes: 0,
      workSessionCount: 0,
    });
    expect(report.dailyCourierSummaries[0]).toMatchObject({
      restaurantName: 'Restaurant Test',
      workMinutes: 0,
      workSessionCount: 0,
    });
    expect(report.workSummaries).toContainEqual(
      expect.objectContaining({
        courierName: 'Ana',
        sourceName: 'Livrări Bunicu Costi',
        workMinutes: 120,
        sessionCount: 1,
      }),
    );
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'availability',
        courierName: 'Ion',
        reason: 'Indisponibil fara un mesaj disponibil anterior pentru acelasi livrator.',
      }),
    );
  });

  it('adds repeated Online/Offline sessions only for the same courier', () => {
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: Online',
        '30.05.2026, 10:00 - Ana: Offline',
        '30.05.2026, 11:00 - Ana: online',
        '30.05.2026, 12:30 - Ana: offline',
        '30.05.2026, 09:30 - Ion: Disponibil',
        '30.05.2026, 11:30 - Ion: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
    );
    const report = buildScanReport(
      [],
      { fromIso: new Date(2026, 4, 30, 8, 0).toISOString(), toIso: new Date(2026, 4, 30, 13, 0).toISOString() },
      {},
      availability.availabilityMessages,
    );

    expect(report.summaries.find((summary) => summary.displayName === 'Ana')).toMatchObject({ workMinutes: 150, workSessionCount: 2 });
    expect(report.summaries.find((summary) => summary.displayName === 'Ion')).toMatchObject({ workMinutes: 120, workSessionCount: 1 });
  });

  it('accepts conservative spelling mistakes in availability messages and keeps them in review', () => {
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: Onlin',
        '30.05.2026, 10:30 - Ana: Ofline',
      ].join('\n'),
      'Conversație WhatsApp cu Pontaj.txt',
    );
    const report = buildScanReport(
      [],
      { fromIso: new Date(2026, 4, 30, 8, 0).toISOString(), toIso: new Date(2026, 4, 30, 11, 0).toISOString() },
      {},
      availability.availabilityMessages,
    );

    expect(report.summaries.find((summary) => summary.displayName === 'Ana')).toMatchObject({ workMinutes: 90, workSessionCount: 1 });
    expect(report.reviewRows).toContainEqual(expect.objectContaining({
      kind: 'availability',
      courierName: 'Ana',
      reason: expect.stringContaining('Corectat automat'),
    }));
  });

  it('keeps a single pickup after 23:00 on the day tariff when a configured night restaurant posted its order before 23:00', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 22:50 - Pizzeria Romana: Comanda noua, Strada Republicii 10, telefon 0740123456',
        '30.05.2026, 23:10 - Ana: Ridicat x1',
        '30.05.2026, 23:25 - Ana: Livrat x1',
      ].join('\n'),
      'Conversație WhatsApp cu Pizzeria ROMANA Delivery.txt',
      undefined,
      'Pizzeria Romana',
    );
    const scheduledMessages = applyRestaurantScheduleTariff(parsed.messages, parsed.conversationLines, {
      openingTime: '10:00', closingTime: '04:00', closesNextDay: true, usesRestaurantOrderTimeForNightTariff: true,
    });
    const report = buildScanReport(
      scheduledMessages,
      {
        fromIso: new Date(scheduledMessages[0].timestampMs - 60 * 60_000).toISOString(),
        toIso: new Date(scheduledMessages[scheduledMessages.length - 1].timestampMs + 60 * 60_000).toISOString(),
      },
      {},
    );

    expect(report.totalPickedUp).toBe(1);
    expect(report.totalNightPickedUp).toBe(0);
  });

  it('retains 00:00-03:00 orders in an overnight restaurant report and anchors them to the operating night', () => {
    const schedule = {
      openingTime: '10:00', closingTime: '03:00', closesNextDay: true, usesRestaurantOrderTimeForNightTariff: true,
    };
    const standardNight = parseWhatsAppExport(
      [
        '31.05.2026, 00:30 - Ana: Ridicat x1 zona 2',
        '31.05.2026, 00:45 - Ana: Livrat x1 zona 2',
      ].join('\n'),
      'Pizzeria noapte.txt',
      undefined,
      'Pizzeria noapte',
    );
    const standardReport = buildScanReport(
      filterMessagesForRestaurantSchedule(standardNight.messages, schedule),
      { fromIso: new Date(2026, 4, 30, 22, 0).toISOString(), toIso: new Date(2026, 4, 31, 4, 0).toISOString() },
      {},
    );
    expect(standardReport.totalPickedUp).toBe(0);
    expect(standardReport.totalNightPickedUp).toBe(1);
    expect(standardReport.dailyCourierSummaries[0]).toMatchObject({ dayKey: '2026-05-30', nightPickedUp: 1 });

    const priorDayOrder = parseWhatsAppExport(
      [
        '30.05.2026, 22:50 - Pizzeria Romana: Comanda noua, Strada Republicii 10, telefon 0740123456',
        '31.05.2026, 00:30 - Ana: Ridicat x1',
        '31.05.2026, 00:45 - Ana: Livrat x1',
      ].join('\n'),
      'Pizzeria Romana noapte.txt',
      undefined,
      'Pizzeria Romana',
    );
    const adjusted = applyRestaurantScheduleTariff(
      filterMessagesForRestaurantSchedule(priorDayOrder.messages, schedule),
      priorDayOrder.conversationLines,
      schedule,
    );
    const adjustedReport = buildScanReport(
      adjusted,
      { fromIso: new Date(2026, 4, 30, 22, 0).toISOString(), toIso: new Date(2026, 4, 31, 4, 0).toISOString() },
      {},
    );
    expect(adjustedReport.totalPickedUp).toBe(1);
    expect(adjustedReport.totalNightPickedUp).toBe(0);
    expect(adjustedReport.dailyCourierSummaries[0]).toMatchObject({ dayKey: '2026-05-30', pickedUp: 1 });
  });

  it('uses each restaurant schedule for pickups while retaining a related delivery after closing', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 09:50 - Ana: Ridicat x1',
        '30.05.2026, 22:50 - Ana: Ridicat x1',
        '30.05.2026, 23:10 - Ana: Livrat x1',
        '30.05.2026, 23:20 - Ana: Ridicat x1',
      ].join('\n'),
      'Restaurant Program.txt',
    );
    const filtered = filterMessagesForRestaurantSchedule(parsed.messages, {
      openingTime: '10:00', closingTime: '23:00', closesNextDay: false, usesRestaurantOrderTimeForNightTariff: false,
    });

    expect(filtered.map((message) => message.originalMessage)).toEqual(['Ridicat x1', 'Livrat x1']);
  });

  it('keeps restaurant programs independent when reports combine multiple restaurant imports', () => {
    const boulevard = parseWhatsAppExport(
      [
        '30.05.2026, 10:30 - Ana: Ridicat x1',
        '30.05.2026, 12:00 - Ana: Ridicat x1',
      ].join('\n'),
      'Boulevard.txt',
      undefined,
      'Boulevard',
    );
    const penes = parseWhatsAppExport(
      [
        '30.05.2026, 12:00 - Ion: Ridicat x1',
        '30.05.2026, 16:00 - Ion: Ridicat x1',
      ].join('\n'),
      'Penes Food.txt',
      undefined,
      'Penes Food',
    );

    const boulevardFiltered = filterMessagesForRestaurantSchedule(boulevard.messages, {
      openingTime: '11:00', closingTime: '21:30', closesNextDay: false, usesRestaurantOrderTimeForNightTariff: false,
    });
    const penesFiltered = filterMessagesForRestaurantSchedule(penes.messages, {
      openingTime: '14:00', closingTime: '22:00', closesNextDay: false, usesRestaurantOrderTimeForNightTariff: false,
    });

    const report = buildScanReport(
      [...boulevardFiltered, ...penesFiltered],
      { fromIso: new Date(2026, 4, 30, 10, 0).toISOString(), toIso: new Date(2026, 4, 30, 17, 0).toISOString() },
      {},
    );

    expect(report.totalPickedUp).toBe(2);
    expect(report.restaurantSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ restaurantName: 'Boulevard', pickedUp: 1 }),
      expect.objectContaining({ restaurantName: 'Penes Food', pickedUp: 1 }),
    ]));
  });

  it('uses scan options to extract only order counts when requested', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: Disponibil',
        '30.05.2026, 10:00 - Ana: ridicat x1',
        '30.05.2026, 10:20 - Ana: livrat x1 zona 2',
        '30.05.2026, 17:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Grup Mixt.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 8, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 18, 0).toISOString(),
      },
      {},
      parsed.availabilityMessages,
      { scanOrders: true, scanWorkHours: false, scanDeliveryTimes: false },
    );

    expect(report.totalDelivered).toBe(1);
    expect(report.totalWorkMinutes).toBe(0);
    expect(report.summaries[0]).toMatchObject({
      delivered: 1,
      workMinutes: 0,
      averageDeliveryMinutes: null,
    });
  });

  it('uses scan options to extract only work hours when requested', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: Disponibil',
        '30.05.2026, 10:00 - Ana: ridicat x1',
        '30.05.2026, 10:20 - Ana: livrat x1',
        '30.05.2026, 17:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Grup Mixt.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 8, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 18, 0).toISOString(),
      },
      {},
      parsed.availabilityMessages,
      { scanOrders: false, scanWorkHours: true, scanDeliveryTimes: false },
    );

    expect(report.totalMessagesInInterval).toBe(0);
    expect(report.totalDelivered).toBe(0);
    expect(report.totalWorkMinutes).toBe(480);
    expect(report.workSummaries[0]).toMatchObject({
      courierName: 'Ana',
      workMinutes: 480,
    });
  });

  it('uses scan options to extract only delivery-time averages when requested', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 10:00 - Ana: ridicat x1',
        '30.05.2026, 10:25 - Ana: livrat x1',
      ].join('\n'),
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 9, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 11, 0).toISOString(),
      },
      {},
      [],
      { scanOrders: false, scanWorkHours: false, scanDeliveryTimes: true },
    );

    expect(report.totalPickedUp).toBe(0);
    expect(report.totalDelivered).toBe(0);
    expect(report.summaries[0]).toMatchObject({
      displayName: 'Ana',
      pickedUp: 0,
      delivered: 0,
      deliveryTimeSampleCount: 1,
      averageDeliveryMinutes: 25,
    });
  });

  it('clips work sessions to the selected interval and splits them by day', () => {
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 22:00 - Ana: Disponibil',
        '31.05.2026, 02:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
    );

    const report = buildScanReport(
      [],
      {
        fromIso: new Date(2026, 4, 30, 23, 0).toISOString(),
        toIso: new Date(2026, 4, 31, 1, 0).toISOString(),
      },
      {},
      availability.availabilityMessages,
    );

    expect(report.totalWorkMinutes).toBe(120);
    expect(report.workSummaries).toEqual([
      expect.objectContaining({ dayKey: '2026-05-30', workMinutes: 60 }),
      expect.objectContaining({ dayKey: '2026-05-31', workMinutes: 60 }),
    ]);
  });

  it('flags scheduled availability messages without using them for work-hour totals', () => {
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: O sa fiu disponibil de la 10 pana la 12',
        '30.05.2026, 12:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
    );

    const report = buildScanReport(
      [],
      {
        fromIso: new Date(2026, 4, 30, 8, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 13, 0).toISOString(),
      },
      {},
      availability.availabilityMessages,
    );

    expect(report.totalWorkMinutes).toBe(0);
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'availability',
        courierName: 'Ana',
        reason:
          'Mesajul pare programare viitoare sau interval textual; nu este folosit automat la calculul orelor.',
      }),
    );
  });

  it('flags very long work sessions instead of counting likely missing availability messages', () => {
    const availability = parseWhatsAppExport(
      [
        '30.05.2026, 09:00 - Ana: Disponibil',
        '31.05.2026, 10:00 - Ana: Indisponibil',
      ].join('\n'),
      'Conversație WhatsApp cu Livrări Bunicu Costi.txt',
    );

    const report = buildScanReport(
      [],
      {
        fromIso: new Date(2026, 4, 30, 8, 0).toISOString(),
        toIso: new Date(2026, 4, 31, 11, 0).toISOString(),
      },
      {},
      availability.availabilityMessages,
    );

    expect(report.totalWorkMinutes).toBe(0);
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'availability',
        courierName: 'Ana',
        reason:
          'Intervalul Disponibil/Indisponibil depaseste 18 ore; probabil lipseste un mesaj si nu este folosit automat la calcul.',
      }),
    );
  });

  it('adds mismatch rows when picked up and delivered totals differ', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: ridicat x2',
        '30.05.2026, 21:22 - Ana: livrat x1',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0].difference).toBe(1);
    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'mismatch',
        courierName: 'Ana',
        difference: 1,
        sourceMessageIds: parsed.messages.map((message) => message.id),
      }),
    );
  });

  it('keeps each paid pickup linked to its completed zone and delivery message for metric drill-down', () => {
    const parsed = parseWhatsAppExport(
      [
        '30.05.2026, 21:14 - Ana: ridicat x1',
        '30.05.2026, 21:22 - Ana: livrat x1 zona 2',
      ].join('\n'),
      'chat.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.summaries[0].zoneCounts.zone2).toBe(1);
    expect(report.metricSources).toContainEqual(
      expect.objectContaining({
        courierName: 'Ana',
        period: 'day',
        classification: 'zone2',
        pickupMessageId: parsed.messages[0].id,
        deliveryMessageId: parsed.messages[1].id,
      }),
    );
  });

  it('keeps exact source context on message review rows', () => {
    const parsed = parseWhatsAppExport(
      '30.05.2026, 21:14 - Ana: livrt x1 zona 2',
      'Conversație WhatsApp cu Restaurant Test.txt',
    );

    const report = buildScanReport(
      parsed.messages,
      {
        fromIso: new Date(2026, 4, 30, 21, 0).toISOString(),
        toIso: new Date(2026, 4, 30, 22, 0).toISOString(),
      },
      {},
    );

    expect(report.reviewRows).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        messageId: parsed.messages[0].id,
        sourceFile: 'Conversație WhatsApp cu Restaurant Test.txt',
        lineNumber: 1,
        rawLine: '30.05.2026, 21:14 - Ana: livrt x1 zona 2',
      }),
    );
  });

  it('rejects inverted or invalid intervals', () => {
    expect(() =>
      buildScanReport(
        [],
        {
          fromIso: new Date(2026, 4, 31).toISOString(),
          toIso: new Date(2026, 4, 30).toISOString(),
        },
        {},
      ),
    ).toThrow('Data de inceput trebuie sa fie inainte de data de final.');

    expect(() => buildScanReport([], { fromIso: 'bad', toIso: 'also-bad' }, {})).toThrow(
      'Intervalul selectat nu are date valide.',
    );
  });
});
