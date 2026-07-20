import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildScanReport, parseWhatsAppExport } from '../shared/parser';
import type { Restaurant } from '../shared/types';
import { buildReportWorkbook } from './App';

function restaurant(id: string, name: string, closesNextDay = false): Restaurant {
  return {
    id,
    name,
    aliases: [],
    schedule: {
      openingTime: '10:00',
      closingTime: closesNextDay ? '03:00' : '23:00',
      tariffPolicy: closesNextDay ? 'night_after_23' : 'day_only',
      closesNextDay,
      usesRestaurantOrderTimeForNightTariff: closesNextDay,
    },
    isActive: true,
    notes: '',
    createdAtIso: '2026-07-15T00:00:00.000Z',
    updatedAtIso: '2026-07-15T00:00:00.000Z',
  };
}

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
  it('exports only one visible daily sheet for each restaurant', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [restaurant('restaurant-alfa', 'Restaurant Alfa'), restaurant('restaurant-beta', 'Restaurant Beta')],
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Restaurant Alfa', 'Restaurant Beta']);
    expect(workbook.getWorksheet('Restaurant Alfa')?.getCell('A1').value).toBe('IFRIMDIGITAL - Restaurant Alfa');
  });

  it('does not depend on payroll settings for restaurant export', () => {
    expect(() => buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [],
    )).not.toThrow();
  });

  it('omits all night columns for a restaurant with a day-only program', () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(), ExcelJS, { scope: 'full', restaurantIds: [] },
      [restaurant('restaurant-alfa', 'Restaurant Alfa'), restaurant('restaurant-beta', 'Restaurant Beta')],
    );
    const sheet = workbook.getWorksheet('Restaurant Alfa');
    const headerRow = sheet?.findRow(7);
    expect(headerRow?.values).toEqual(expect.arrayContaining(['Total\ncomenzi\nzi', 'Zona 1\nzi', 'Zona 2\nzi', 'Zona 3\nzi', 'Comenzi\nspeciale\nzi']));
    expect(headerRow?.values).not.toEqual(expect.arrayContaining(['Total\ncomenzi\nnoapte', 'Comenzi\nspeciale\nnoapte', 'Review']));
    expect(sheet?.columnCount).toBe(10);
    expect(headerRow?.height).toBeGreaterThanOrEqual(54);
    expect(headerRow?.getCell(2).alignment?.wrapText).toBe(true);
  });

  it('keeps a 10:00-00:00 day-only restaurant on the compact day export layout', () => {
    const midnightDayRestaurant = restaurant('restaurant-alfa', 'Restaurant Alfa', true);
    midnightDayRestaurant.schedule = {
      ...midnightDayRestaurant.schedule,
      closingTime: '00:00',
      tariffPolicy: 'day_only',
    };
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [midnightDayRestaurant, restaurant('restaurant-beta', 'Restaurant Beta')],
    );

    const sheet = workbook.getWorksheet('Restaurant Alfa');
    const headerRow = sheet?.findRow(7);
    expect(headerRow?.values).not.toEqual(expect.arrayContaining(['Total\ncomenzi\nnoapte']));
    expect(sheet?.columnCount).toBe(10);
  });

  it('adds a separate readable night block for a restaurant that closes after midnight', () => {
    const parsed = parseWhatsAppExport(
      [
        '16.07.2026, 00:30 - Ana: ridicat x1 zona 2',
        '16.07.2026, 00:45 - Ana: livrat x1 zona 2',
      ].join('\n'),
      'Restaurant Noapte.txt',
      undefined,
      'Restaurant Noapte',
    );
    const report = buildScanReport(parsed.messages, {
      fromIso: new Date(2026, 6, 15, 22, 0).toISOString(),
      toIso: new Date(2026, 6, 16, 4, 0).toISOString(),
    }, {});
    const workbook = buildReportWorkbook(
      report,
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [restaurant('restaurant-noapte', 'Restaurant Noapte', true)],
    );
    const sheet = workbook.getWorksheet('Restaurant Noapte');
    const headerRow = sheet?.findRow(7);
    expect(report.totalPickedUp).toBe(0);
    expect(report.totalNightPickedUp).toBe(1);
    expect(headerRow?.values).toEqual(expect.arrayContaining(['Total\nzi +\nnoapte', 'Total\ncomenzi\nnoapte', 'Zona 2\nnoapte', 'Comenzi\nspeciale\nnoapte']));
    expect(headerRow?.values).not.toEqual(expect.arrayContaining(['Review']));
    expect(sheet?.columnCount).toBe(16);
  });

  it('serializes the simplified restaurant workbook without Excel repair warnings', async () => {
    const workbook = buildReportWorkbook(
      createTwoRestaurantReport(),
      ExcelJS,
      { scope: 'full', restaurantIds: [] },
      [restaurant('restaurant-alfa', 'Restaurant Alfa'), restaurant('restaurant-beta', 'Restaurant Beta')],
    );
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1_000);
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
