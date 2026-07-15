import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildScanReport, parseWhatsAppExport } from '../shared/parser';
import { defaultPayrollSettings } from '../shared/payroll';
import { buildReportWorkbook } from './App';

const appSettings = {
  nightStartHour: 23,
  nightEndHour: 4,
  maxWorkSessionHours: 18,
  defaultExportScope: 'full' as const,
  importRetentionDays: 30,
  payroll: { ...defaultPayrollSettings, enabled: true },
};

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
  it('puts the salary report first and keeps calculation sheets hidden', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [],
      [],
      appSettings,
    );

    expect(workbook.worksheets.filter((sheet) => sheet.state === 'visible').map((sheet) => sheet.name)).toEqual([
      'Raport salarial',
      'Restaurant Alfa',
      'Restaurant Beta',
      'Avertizari salariale',
    ]);
    expect(workbook.getWorksheet('Date calcul')?.state).toBe('veryHidden');
    expect(workbook.getWorksheet('Setari calcul')?.state).toBe('veryHidden');
  });

  it('requires explicit payroll activation for financial exports', () => {
    expect(() => buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [],
      [],
      { ...appSettings, payroll: { ...appSettings.payroll, enabled: false } },
    )).toThrow(/nu este activat/i);
  });

  it('wraps the special night header and gives it enough width', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(), ExcelJS, { scope: 'full', restaurantIds: [] }, [], [], appSettings,
    );
    const sheet = workbook.getWorksheet('Restaurant Alfa');
    const headerRow = sheet?.findRow(7);
    expect(sheet?.getColumn(11).width).toBeGreaterThanOrEqual(20);
    expect(headerRow?.getCell(11).value).toBe('Speciale noapte');
    expect(headerRow?.getCell(11).alignment?.wrapText).toBe(true);
  });

  it('keeps the global workbook available only through its dedicated scope', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'global', restaurantIds: [] },
      [],
      [],
      appSettings,
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Raport final livratori']);
  });
});
