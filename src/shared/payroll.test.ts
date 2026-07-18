import { describe, expect, it } from 'vitest';
import { buildScanReport, parseWhatsAppExport } from './parser';
import { buildPayrollResult, defaultPayrollSettings } from './payroll';
import type { AppSettings, Courier, Restaurant } from './types';

const restaurant: Restaurant = {
  id: 'restaurant-1', name: 'Restaurant Test', aliases: [], isActive: true, notes: '',
  schedule: { openingTime: '10:00', closingTime: '23:00', closesNextDay: false, usesRestaurantOrderTimeForNightTariff: false },
  createdAtIso: '2026-07-15T00:00:00.000Z', updatedAtIso: '2026-07-15T00:00:00.000Z',
};
const courier: Courier = {
  id: 'courier-1', name: 'Roby', phone: '+40700000000', aliases: ['Robert'], isActive: true, notes: '',
  createdAtIso: '2026-07-15T00:00:00.000Z', updatedAtIso: '2026-07-15T00:00:00.000Z',
};
const settings: AppSettings = {
  nightStartHour: 23, nightEndHour: 4, maxWorkSessionHours: 18, defaultExportScope: 'full', importRetentionDays: 30,
  payroll: {
    ...defaultPayrollSettings,
    restaurantMethods: { [restaurant.id]: 'cash' },
    courierRules: {
      [courier.id]: { calculationMode: 'all', commissionPerOrder: 1.5, taxRate: 0.1, invoiceCommissionPerOrder: 0 },
    },
  },
};

function createReport() {
  const parsed = parseWhatsAppExport([
    '15.07.2026, 10:00 - Robert: ridicat x2 (1 x zona 2)',
    '15.07.2026, 10:20 - Robert: livrat x2',
    '15.07.2026, 23:10 - Robert: ridicat x1 zona 3',
    '15.07.2026, 23:30 - Robert: livrat x1',
  ].join('\n'), 'Restaurant Test.txt', undefined, restaurant.name);
  const report = buildScanReport(parsed.messages, {
    fromIso: new Date(2026, 6, 15, 9).toISOString(),
    toIso: new Date(2026, 6, 16, 1).toISOString(),
  }, { Robert: 'Roby' });
  report.dailyCourierSummaries.forEach((row) => { row.restaurantId = restaurant.id; });
  return report;
}

describe('payroll calculations', () => {
  it('uses day and night zone tariffs without double counting', () => {
    const result = buildPayrollResult(createReport(), settings, [restaurant], [courier]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      courierName: 'Roby', dayOrders: 2, nightOrders: 1, dayValueBani: 3700, nightValueBani: 3400,
    });
    expect(result.couriers[0].totalValueBani).toBe(7100);
  });

  it('applies commission and tax in integer bani', () => {
    const result = buildPayrollResult(createReport(), settings, [restaurant], [courier]);
    expect(result.couriers[0]).toMatchObject({
      commissionBani: 450,
      taxBani: 665,
      amountDueBani: 5985,
    });
  });

  it('documents the client cash-only rule across cash, paid cash and invoiced orders', () => {
    const parsed = parseWhatsAppExport([
      '15.07.2026, 10:00 - Robert: ridicat x1',
      '15.07.2026, 10:10 - Robert: livrat x1',
    ].join('\n'), 'Restaurant Test.txt', undefined, restaurant.name);
    const report = buildScanReport(parsed.messages, {
      fromIso: new Date(2026, 6, 15, 9).toISOString(),
      toIso: new Date(2026, 6, 15, 12).toISOString(),
    }, { Robert: 'Roby' });
    const baseRow = report.dailyCourierSummaries[0];
    const restaurants: Restaurant[] = (['cash', 'cashPaid', 'invoiced'] as const).map((method, index) => ({
      ...restaurant,
      id: `restaurant-${method}`,
      name: `Restaurant ${method}`,
      aliases: [],
      notes: '',
      createdAtIso: restaurant.createdAtIso,
      updatedAtIso: restaurant.updatedAtIso,
    }));
    report.dailyCourierSummaries = restaurants.map((item) => ({
      ...baseRow,
      restaurantId: item.id,
      restaurantName: item.name,
    }));
    const result = buildPayrollResult(report, {
      ...settings,
      payroll: {
        ...settings.payroll,
        restaurantMethods: Object.fromEntries(restaurants.map((item, index) => [
          item.id,
          (['cash', 'cashPaid', 'invoiced'] as const)[index],
        ])),
        courierRules: {
          [courier.id]: {
            calculationMode: 'cashOnly', commissionPerOrder: 0,
            taxRate: 0, invoiceCommissionPerOrder: 1,
          },
        },
      },
    }, restaurants, [courier]);

    expect(result.couriers[0]).toMatchObject({
      totalOrders: 3,
      cashBani: 1400,
      cashPaidBani: 1400,
      invoicedBani: 1600,
      commissionBani: 300,
      amountDueBani: 1100,
    });
  });
});
