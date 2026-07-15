import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildScanReport, parseWhatsAppExport } from '../shared/parser';
import { buildReportWorkbook } from './App';

function createTwoRestaurantReport() {
  const first = parseWhatsAppExport(
    [
      '15.07.2026, 10:00 - Ana: ridicat x1',
      '15.07.2026, 10:10 - Ana: livrat x1',
    ].join('\n'),
    'Restaurant Alfa.txt',
    undefined,
    'Restaurant Alfa',
  );
  const second = parseWhatsAppExport(
    [
      '15.07.2026, 11:00 - Bogdan: ridicat x1',
      '15.07.2026, 11:15 - Bogdan: livrat x1',
    ].join('\n'),
    'Restaurant Beta.txt',
    undefined,
    'Restaurant Beta',
  );
  return buildScanReport(
    [...first.messages, ...second.messages],
    {
      fromIso: new Date(2026, 6, 15, 9, 0).toISOString(),
      toIso: new Date(2026, 6, 15, 12, 0).toISOString(),
    },
    {},
  );
}

describe('restaurant workbook export', () => {
  it('puts only restaurant worksheets in the primary full export', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [],
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Restaurant Alfa',
      'Restaurant Beta',
    ]);
  });

  it('keeps the global workbook available only through its dedicated scope', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'global', restaurantIds: [] },
      [],
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Raport final livratori']);
  });
});
