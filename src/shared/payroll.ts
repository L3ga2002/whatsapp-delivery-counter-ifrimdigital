import type {
  AppSettings,
  Courier,
  DailyCourierSummary,
  PayrollCourierRule,
  PayrollPaymentMethod,
  PayrollSettings,
  Restaurant,
  ScanReport,
} from './types';

export const defaultPayrollSettings: PayrollSettings = {
  enabled: false,
  zoneRates: {
    zone1: { dayCash: 14, dayInvoiced: 16, nightCash: 17, nightInvoiced: 100 },
    zone2: { dayCash: 23, dayInvoiced: 26, nightCash: 25, nightInvoiced: 150 },
    zone3: { dayCash: 34, dayInvoiced: 36, nightCash: 34, nightInvoiced: 200 },
  },
  restaurantMethods: {},
  courierRules: {},
  restaurantCourierOverrides: {},
  commissionAdjustmentLei: 80,
};

export interface PayrollLine {
  id: string;
  dayKey: string;
  dateLabel: string;
  restaurantId: string;
  restaurantName: string;
  courierId: string | null;
  courierName: string;
  paymentMethod: PayrollPaymentMethod;
  dayOrders: number;
  nightOrders: number;
  totalOrders: number;
  dayValueBani: number;
  nightValueBani: number;
  totalValueBani: number;
  reviewCount: number;
  warning: string;
}

export interface PayrollCourierSummary {
  courierId: string | null;
  courierName: string;
  calculationMode: PayrollCourierRule['calculationMode'];
  totalOrders: number;
  cashPaidBani: number;
  invoicedBani: number;
  cashBani: number;
  totalValueBani: number;
  commissionPerOrderBani: number;
  commissionBani: number;
  taxRate: number;
  taxBani: number;
  amountDueBani: number;
  reviewCount: number;
  warningCount: number;
}

export interface PayrollResult {
  lines: PayrollLine[];
  couriers: PayrollCourierSummary[];
  warnings: string[];
}

const restaurantMethodDefaults: Array<[string[], PayrollPaymentMethod]> = [
  [['mastro', 'il campione parc', 'floraria din povesti', 'pizzeria joker'], 'cashPaid'],
  [[
    'pescobella', 'michelino', 'penes', 'lake house', 'hanzo', 'flat bite', 'hamlet',
    'la vaca grasa', 'kai sushi', 'r a flowers', 'baba kebab',
  ], 'invoiced'],
  [['boulevard', 'pizzeria romana', 'le wrap', 'bodega', 'maua'], 'cash'],
];

const courierRuleDefaults: Array<[string, PayrollCourierRule]> = [
  ['eu', rule('all', 0, 0, 0)],
  ['george', rule('cashOnly', 0, 0, 1.5)],
  ['alberto', rule('all', 1.5, 0.1, 0)],
  ['claudiu', rule('cashOnly', 0, 0, 1.3)],
  ['alex', rule('all', 0.5, 0.05, 0)],
  ['daniel', rule('cashOnly', 0, 0, 1)],
  ['david', rule('all', 1.3, 0.1, 0)],
  ['denisu', rule('cashOnly', 0, 0, 1)],
  ['cosmin', rule('cashOnly', 0, 0, 1.1)],
  ['bunicu', rule('all', 0, 0, 0)],
  ['lucian', rule('cashOnly', 0, 0, 1.4)],
  ['titi', rule('all', 1.3, 0.09, 0)],
];

export function mergePayrollSettings(input?: Partial<PayrollSettings>): PayrollSettings {
  return {
    ...defaultPayrollSettings,
    ...input,
    zoneRates: {
      zone1: { ...defaultPayrollSettings.zoneRates.zone1, ...input?.zoneRates?.zone1 },
      zone2: { ...defaultPayrollSettings.zoneRates.zone2, ...input?.zoneRates?.zone2 },
      zone3: { ...defaultPayrollSettings.zoneRates.zone3, ...input?.zoneRates?.zone3 },
    },
    restaurantMethods: { ...input?.restaurantMethods },
    courierRules: { ...input?.courierRules },
    restaurantCourierOverrides: { ...input?.restaurantCourierOverrides },
  };
}

export function buildPayrollResult(
  report: ScanReport,
  settings: AppSettings,
  restaurants: Restaurant[],
  couriers: Courier[],
): PayrollResult {
  const payroll = mergePayrollSettings(settings.payroll);
  const restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const lines = report.dailyCourierSummaries.map((row) =>
    buildPayrollLine(row, payroll, restaurantById.get(row.restaurantId), couriers),
  );
  const warnings = Array.from(new Set(lines.map((line) => line.warning).filter(Boolean)));
  return {
    lines,
    couriers: aggregatePayrollCouriers(lines, payroll, couriers),
    warnings,
  };
}

export function resolveRestaurantMethod(
  payroll: PayrollSettings,
  restaurant?: Restaurant,
  restaurantName = '',
): { method: PayrollPaymentMethod; configured: boolean } {
  if (restaurant && payroll.restaurantMethods[restaurant.id]) {
    return { method: payroll.restaurantMethods[restaurant.id], configured: true };
  }
  const normalized = normalizeIdentity(restaurant?.name || restaurantName);
  for (const [names, method] of restaurantMethodDefaults) {
    if (names.some((name) => normalized.includes(name))) return { method, configured: false };
  }
  return { method: 'cash', configured: false };
}

export function resolveCourierRule(payroll: PayrollSettings, courier?: Courier, courierName = ''): PayrollCourierRule {
  if (courier && payroll.courierRules[courier.id]) return payroll.courierRules[courier.id];
  const normalized = normalizeIdentity(courier?.name || courierName);
  return courierRuleDefaults.find(([name]) => normalized === name || normalized.startsWith(`${name} `))?.[1]
    ?? rule('all', 0, 0, 0);
}

function buildPayrollLine(
  row: DailyCourierSummary,
  payroll: PayrollSettings,
  restaurant: Restaurant | undefined,
  couriers: Courier[],
): PayrollLine {
  const courier = findCourier(couriers, row.courierName);
  const defaultMethod = resolveRestaurantMethod(payroll, restaurant, row.restaurantName);
  const overrideKey = restaurant && courier ? `${restaurant.id}:${courier.id}` : '';
  const paymentMethod = payroll.restaurantCourierOverrides[overrideKey] ?? defaultMethod.method;
  const dayValueBani = calculateZoneValueBani(row, payroll, paymentMethod, false);
  const nightValueBani = calculateZoneValueBani(row, payroll, paymentMethod, true);
  const warnings: string[] = [];
  if (!restaurant) warnings.push(`Restaurant neidentificat: ${row.restaurantName}`);
  if (!defaultMethod.configured) warnings.push(`Metoda de plata nesalvata: ${row.restaurantName}`);
  if (!courier) warnings.push(`Curier neasociat: ${row.courierName}`);
  if (row.outsideZoneDeliveries > 0 && row.outsideAmountLei <= 0) {
    warnings.push(`Comenzi speciale zi fara suma: ${row.restaurantName} / ${row.courierName}`);
  }
  if (row.nightOutsideZoneDeliveries > 0 && row.nightOutsideAmountLei <= 0) {
    warnings.push(`Comenzi speciale noapte fara suma: ${row.restaurantName} / ${row.courierName}`);
  }
  return {
    id: row.id,
    dayKey: row.dayKey,
    dateLabel: row.dateLabel,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    courierId: courier?.id ?? null,
    courierName: courier?.name ?? row.courierName,
    paymentMethod,
    dayOrders: row.pickedUp,
    nightOrders: row.nightPickedUp,
    totalOrders: row.pickedUp + row.nightPickedUp,
    dayValueBani,
    nightValueBani,
    totalValueBani: dayValueBani + nightValueBani,
    reviewCount: row.reviewCount,
    warning: warnings.join(' | '),
  };
}

function calculateZoneValueBani(
  row: DailyCourierSummary,
  payroll: PayrollSettings,
  method: PayrollPaymentMethod,
  night: boolean,
): number {
  const zones = night ? row.nightZoneCounts : row.zoneCounts;
  const amountLei = night ? row.nightOutsideAmountLei : row.outsideAmountLei;
  const rateKey = night
    ? method === 'invoiced' ? 'nightInvoiced' : 'nightCash'
    : method === 'invoiced' ? 'dayInvoiced' : 'dayCash';
  const valueLei =
    zones.zone1 * payroll.zoneRates.zone1[rateKey] +
    zones.zone2 * payroll.zoneRates.zone2[rateKey] +
    zones.zone3 * payroll.zoneRates.zone3[rateKey] +
    safeMoney(amountLei);
  return toBani(valueLei);
}

function aggregatePayrollCouriers(
  lines: PayrollLine[],
  payroll: PayrollSettings,
  couriers: Courier[],
): PayrollCourierSummary[] {
  const grouped = new Map<string, PayrollLine[]>();
  for (const line of lines) {
    const key = line.courierId ?? `raw:${normalizeIdentity(line.courierName)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }
  return Array.from(grouped.values()).map((courierLines) => {
    const first = courierLines[0];
    const courier = couriers.find((item) => item.id === first.courierId);
    const courierRule = resolveCourierRule(payroll, courier, first.courierName);
    const totalOrders = courierLines.reduce((sum, line) => sum + line.totalOrders, 0);
    const cashPaidBani = sumByMethod(courierLines, 'cashPaid');
    const invoicedBani = sumByMethod(courierLines, 'invoiced');
    const cashBani = sumByMethod(courierLines, 'cash');
    const totalValueBani = cashPaidBani + invoicedBani + cashBani;
    const commissionPerOrder = courierRule.calculationMode === 'all'
      ? courierRule.commissionPerOrder
      : courierRule.invoiceCommissionPerOrder;
    const commissionBani = toBani(totalOrders * commissionPerOrder);
    const receivableBeforeCommissionBani = courierRule.calculationMode === 'all'
      ? cashBani + invoicedBani
      : cashBani;
    const afterCommissionBani = Math.max(0, receivableBeforeCommissionBani - commissionBani);
    const taxBani = courierRule.calculationMode === 'all'
      ? Math.round(afterCommissionBani * safeRate(courierRule.taxRate))
      : 0;
    return {
      courierId: first.courierId,
      courierName: first.courierName,
      calculationMode: courierRule.calculationMode,
      totalOrders,
      cashPaidBani,
      invoicedBani,
      cashBani,
      totalValueBani,
      commissionPerOrderBani: toBani(commissionPerOrder),
      commissionBani,
      taxRate: safeRate(courierRule.taxRate),
      taxBani,
      amountDueBani: Math.max(0, afterCommissionBani - taxBani),
      reviewCount: courierLines.reduce((sum, line) => sum + line.reviewCount, 0),
      warningCount: courierLines.filter((line) => line.warning).length,
    };
  }).sort((left, right) => left.courierName.localeCompare(right.courierName, 'ro-RO'));
}

function findCourier(couriers: Courier[], name: string): Courier | undefined {
  const normalized = normalizeIdentity(name);
  return couriers.find((courier) =>
    [courier.name, courier.phone, ...courier.aliases].some((identity) => normalizeIdentity(identity) === normalized),
  );
}

function sumByMethod(lines: PayrollLine[], method: PayrollPaymentMethod): number {
  return lines.reduce((sum, line) => sum + (line.paymentMethod === method ? line.totalValueBani : 0), 0);
}

function rule(
  calculationMode: PayrollCourierRule['calculationMode'],
  commissionPerOrder: number,
  taxRate: number,
  invoiceCommissionPerOrder: number,
): PayrollCourierRule {
  return { calculationMode, commissionPerOrder, taxRate, invoiceCommissionPerOrder };
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function safeMoney(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeRate(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function toBani(valueLei: number): number {
  return Math.round((Number.isFinite(valueLei) ? valueLei : 0) * 100);
}

export function fromBani(valueBani: number): number {
  return Math.round(valueBani) / 100;
}
