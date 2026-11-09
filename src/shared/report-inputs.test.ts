import { describe, expect, it } from 'vitest';
import { parseImportedTexts } from './parser';
import { serializeImportResult } from './import-storage';
import { scanStoredReport } from './report-inputs';
import type { Restaurant, StoredReportImport } from './types';

describe('isolated report scan pipeline', () => {
  it('preserves physical source line numbers when the export contains blank lines', () => {
    const text = '\n02.11.2026, 12:00 - Curier test: Ridicat x1\n\n\n02.11.2026, 12:10 - Curier test: Livrat x1\n\n02.11.2026, 13:00 - Curier test: Ridicat x1\n02.11.2026, 13:10 - Curier test: Livrat x1';
    const imported = parseImportedTexts([{ sourceFile: 'blank-lines.txt', text, bytes: text.length }]);
    const stored: StoredReportImport = { id: 'import', reportId: 'report', role: 'restaurant', restaurantId: null, sourceLabel: 'Test', importedAtIso: '',
      fileCount: 1, messageCount: 4, availabilityMessageCount: 0, issueCount: 0, importResultJson: serializeImportResult(imported) };
    const report = scanStoredReport([stored], [], { fromIso: '2026-11-02T00:00:00Z', toIso: '2026-11-03T00:00:00Z' }, {},
      { scanOrders: true, scanWorkHours: false, scanDeliveryTimes: true });
    expect(report.totalPickedUp).toBe(2);
    expect(report.metricSources.map((source) => source.pickupLineNumber)).toEqual([2, 7]);
    expect(report.metricSources.map((source) => source.deliveryLineNumber)).toEqual([5, 8]);
  });
  it.each([
    ['23:00', 'day_only', 2, 0],
    ['00:00', 'day_only', 3, 0],
    ['01:00', 'day_only', 4, 0],
    ['02:00', 'day_only', 5, 0],
    ['03:00', 'day_only', 6, 0],
    ['04:00', 'day_only', 7, 0],
    ['00:00', 'night_after_23', 2, 1],
    ['01:00', 'night_after_23', 2, 2],
    ['02:00', 'night_after_23', 2, 3],
    ['03:00', 'night_after_23', 2, 4],
    ['04:00', 'night_after_23', 2, 5],
  ] as const)('keeps schedule %s / %s and independent expected counts', (closingTime, tariffPolicy, day, night) => {
    const timestamps = [['02.11.2026', '10:05', '10:10'], ['02.11.2026', '22:50', '22:55'], ['02.11.2026', '23:10', '23:15'],
      ['03.11.2026', '00:30', '00:35'], ['03.11.2026', '01:30', '01:35'], ['03.11.2026', '02:30', '02:35'], ['03.11.2026', '03:30', '03:35'], ['03.11.2026', '04:30', '04:35']];
    const text = timestamps.flatMap(([date, pickup, delivery]) => [
      `${date}, ${pickup} - Curier test: Ridicat x1 zone 2`, `${date}, ${delivery} - Curier test: Livrat x1 zone 2`,
    ]).join('\n');
    const imported = parseImportedTexts([{ sourceFile: 'chat.txt', text, bytes: text.length }]);
    const stored: StoredReportImport = { id: 'import-1', reportId: 'report-1', role: 'restaurant', restaurantId: 'restaurant-1', sourceLabel: 'Test',
      importedAtIso: '', fileCount: 1, messageCount: imported.messages.length, availabilityMessageCount: 0, issueCount: 0,
      importResultJson: serializeImportResult(imported) };
    const restaurant: Restaurant = { id: 'restaurant-1', name: 'Test', aliases: [], notes: '', isActive: true, createdAtIso: '', updatedAtIso: '',
      schedule: { openingTime: '10:00', closingTime, closesNextDay: closingTime < '10:00', tariffPolicy, usesRestaurantOrderTimeForNightTariff: false } };
    const report = scanStoredReport([stored], [restaurant],
      { fromIso: new Date(2026, 10, 2).toISOString(), toIso: new Date(2026, 10, 3, 23, 59).toISOString() },
      { 'Curier test': 'Cosmin' }, { scanOrders: true, scanWorkHours: false, scanDeliveryTimes: true });
    expect([report.totalPickedUp, report.totalNightPickedUp]).toEqual([day, night]);
    expect(report.summaries.map((row) => row.displayName)).toEqual(['Cosmin']);
    expect(report.metricSources).toHaveLength(day + night);
    expect(report.metricSources.every((source) => source.reportImportId === 'import-1')).toBe(true);
  });
});
