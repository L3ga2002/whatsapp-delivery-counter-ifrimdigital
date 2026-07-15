export type DeliveryStatus = 'ridicat' | 'livrat';

export type AvailabilityStatus = 'disponibil' | 'indisponibil';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type PaidSource = 'pickup' | 'return' | 'completion' | 'none';

export type SourceKind = 'restaurant' | 'availability';

export type ReportStatus = 'draft' | 'scanned' | 'verified' | 'exported';

export type ReportImportRole = 'restaurant' | 'workHours' | 'mixed';

export type ExportScope = 'full' | 'global' | 'restaurants' | 'review' | 'workHours';

export const PARSER_VERSION = '0.3.0';

export interface ZoneCounts {
  zone1: number;
  zone2: number;
  zone3: number;
}

export interface ParsedDeliveryMessage {
  id: string;
  sourceId: string;
  sourceFile: string;
  restaurantId?: string;
  restaurantName: string;
  lineNumber: number;
  timestampIso: string;
  timestampMs: number;
  senderRaw: string;
  status: DeliveryStatus;
  period: 'day' | 'night';
  reportDayKey: string;
  quantity: number;
  zoneCounts: ZoneCounts;
  outsideKilometers: number;
  outsideAmountLei: number;
  paidQuantity: number;
  paidZoneCounts: ZoneCounts;
  paidOutsideZoneDeliveries: number;
  paidOutsideKilometers: number;
  paidOutsideAmountLei: number;
  paidSource: PaidSource;
  note: string;
  confidence: ConfidenceLevel;
  needsReview: boolean;
  reviewReasons: string[];
  originalMessage: string;
  rawLine: string;
}

export interface ParsedAvailabilityMessage {
  id: string;
  sourceId: string;
  sourceFile: string;
  restaurantName: string;
  lineNumber: number;
  timestampIso: string;
  timestampMs: number;
  senderRaw: string;
  status: AvailabilityStatus;
  confidence: ConfidenceLevel;
  usableForWorkHours: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  originalMessage: string;
  rawLine: string;
}

export interface ParseIssue {
  id: string;
  sourceId: string;
  sourceFile: string;
  restaurantName: string;
  lineNumber: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
  rawLine: string;
}

export interface ConversationLine {
  id: string;
  sourceId: string;
  sourceFile: string;
  restaurantId?: string;
  restaurantName: string;
  lineNumber: number;
  timestampIso: string;
  timestampMs: number;
  senderRaw: string;
  message: string;
  rawLine: string;
  isSystemLine: boolean;
}

export interface ParsedChatFile {
  sourceId: string;
  sourceFile: string;
  restaurantName: string;
  sourceKind: SourceKind;
  bytes: number;
  rawLineCount: number;
  parsedMessageCount: number;
  relevantMessageCount: number;
  conversationLines: ConversationLine[];
  messages: ParsedDeliveryMessage[];
  availabilityMessages: ParsedAvailabilityMessage[];
  issues: ParseIssue[];
}

export interface ImportResult {
  importedAtIso: string;
  files: ParsedChatFile[];
  messages: ParsedDeliveryMessage[];
  availabilityMessages: ParsedAvailabilityMessage[];
  issues: ParseIssue[];
}

export interface ScanInterval {
  fromIso: string;
  toIso: string;
}

export interface ScanOptions {
  scanOrders: boolean;
  scanWorkHours: boolean;
  scanDeliveryTimes: boolean;
  includeAllRestaurants?: boolean;
  restaurantIds?: string[];
}

export interface ExportOptions {
  scope: ExportScope;
  restaurantIds: string[];
}

export type AliasMap = Record<string, string>;

export interface DeliveryCounterApi {
  importFromDialog: () => Promise<ImportResult | null>;
  getWorkspace: () => Promise<WorkspaceSnapshot>;
  backupWorkspace: () => Promise<string | null>;
  restoreWorkspace: () => Promise<WorkspaceSnapshot | null>;
  saveSettings: (settings: AppSettings) => Promise<WorkspaceSnapshot>;
  saveRestaurant: (input: RestaurantInput) => Promise<Restaurant>;
  deleteRestaurant: (restaurantId: string) => Promise<void>;
  saveCourier: (input: CourierInput) => Promise<Courier>;
  deleteCourier: (courierId: string) => Promise<void>;
  saveReport: (input: ReportInput) => Promise<Report>;
  deleteReport: (reportId: string) => Promise<WorkspaceSnapshot>;
  importToReport: (input: ReportImportInput) => Promise<ReportImport | null>;
  deleteReportImport: (importId: string) => Promise<WorkspaceSnapshot>;
  deleteAllReportImports: () => Promise<WorkspaceSnapshot>;
  deleteOldReportImports: (retentionDays: number) => Promise<WorkspaceSnapshot>;
  scanSavedReport: (reportId: string, options: ScanOptions) => Promise<ScanReport>;
  getAliases: () => Promise<AliasMap>;
  saveAliases: (aliases: AliasMap) => Promise<AliasMap>;
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateStatus>;
  downloadUpdate: () => Promise<AppUpdateStatus>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (listener: (status: AppUpdateStatus) => void) => () => void;
}

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateStatus {
  currentVersion: string;
  state: AppUpdateState;
  isPackaged: boolean;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  aliases: string[];
  isActive: boolean;
  notes: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface RestaurantInput {
  id?: string;
  name: string;
  aliases?: string[];
  isActive?: boolean;
  notes?: string;
}

export interface Courier {
  id: string;
  name: string;
  phone: string;
  aliases: string[];
  isActive: boolean;
  notes: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CourierInput {
  id?: string;
  name: string;
  phone?: string;
  aliases?: string[];
  isActive?: boolean;
  notes?: string;
}

export interface CourierAlias {
  courierId: string;
  alias: string;
}

export interface Report {
  id: string;
  name: string;
  fromIso: string;
  toIso: string;
  status: ReportStatus;
  scanOptions: ScanOptions;
  parserVersion: string;
  createdAtIso: string;
  updatedAtIso: string;
  scannedAtIso: string | null;
}

export interface ReportInput {
  id?: string;
  name: string;
  fromIso: string;
  toIso: string;
  status?: ReportStatus;
  scanOptions?: ScanOptions;
}

export interface ReportImport {
  id: string;
  reportId: string;
  role: ReportImportRole;
  restaurantId: string | null;
  sourceLabel: string;
  importedAtIso: string;
  fileCount: number;
  messageCount: number;
  availabilityMessageCount: number;
  issueCount: number;
  importResult: ImportResult;
}

export interface ReportImportInput {
  reportId: string;
  role: ReportImportRole;
  restaurantId?: string | null;
}

export interface AppSettings {
  nightStartHour: number;
  nightEndHour: number;
  maxWorkSessionHours: number;
  defaultExportScope: ExportScope;
  importRetentionDays: number;
  payroll: PayrollSettings;
}

export type PayrollPaymentMethod = 'cash' | 'cashPaid' | 'invoiced';

export type PayrollCalculationMode = 'all' | 'cashOnly';

export interface PayrollZoneRate {
  dayCash: number;
  dayInvoiced: number;
  nightCash: number;
  nightInvoiced: number;
}

export interface PayrollCourierRule {
  calculationMode: PayrollCalculationMode;
  commissionPerOrder: number;
  taxRate: number;
  invoiceCommissionPerOrder: number;
}

export interface PayrollSettings {
  enabled: boolean;
  zoneRates: {
    zone1: PayrollZoneRate;
    zone2: PayrollZoneRate;
    zone3: PayrollZoneRate;
  };
  restaurantMethods: Record<string, PayrollPaymentMethod>;
  courierRules: Record<string, PayrollCourierRule>;
  restaurantCourierOverrides: Record<string, PayrollPaymentMethod>;
  commissionAdjustmentLei: number;
}

export interface ParserVersion {
  version: string;
  label: string;
}

export interface WorkspaceSnapshot {
  restaurants: Restaurant[];
  couriers: Courier[];
  reports: Report[];
  reportImports: ReportImport[];
  settings: AppSettings;
  maintenanceNotices: string[];
  parserVersion: ParserVersion;
}

export interface CourierSummary {
  courierId: string;
  displayName: string;
  senderAliases: string[];
  pickedUp: number;
  delivered: number;
  zoneCounts: ZoneCounts;
  outsideZoneDeliveries: number;
  outsideKilometers: number;
  outsideAmountLei: number;
  deliveredWithoutZone: number;
  nightPickedUp: number;
  nightDelivered: number;
  nightZoneCounts: ZoneCounts;
  nightOutsideZoneDeliveries: number;
  nightOutsideKilometers: number;
  nightOutsideAmountLei: number;
  nightDeliveredWithoutZone: number;
  difference: number;
  nightDifference: number;
  workMinutes: number;
  workSessionCount: number;
  workReviewCount: number;
  reviewedCount: number;
  unclearCount: number;
  deliveryTimeSampleCount: number;
  averageDeliveryMinutes: number | null;
  medianDeliveryMinutes: number | null;
  deliveryDurationMinutesSamples: number[];
  sourceMessageIds: string[];
}

export interface MessageReviewRow {
  kind: 'message';
  id: string;
  messageId: string;
  severity: 'warning' | 'error';
  sourceId: string;
  sourceFile: string;
  lineNumber: number;
  restaurantName: string;
  courierName: string;
  timestampIso: string;
  status: DeliveryStatus;
  quantity: number;
  reason: string;
  originalMessage: string;
  rawLine: string;
}

export interface MismatchReviewRow {
  kind: 'mismatch';
  id: string;
  severity: 'warning';
  restaurantName?: string;
  courierName: string;
  pickedUp: number;
  delivered: number;
  difference: number;
  reason: string;
  sourceMessageIds: string[];
}

export interface AvailabilityReviewRow {
  kind: 'availability';
  id: string;
  severity: 'warning';
  sourceId: string;
  sourceFile: string;
  lineNumber: number;
  restaurantName: string;
  courierName: string;
  timestampIso: string;
  status: AvailabilityStatus;
  reason: string;
  originalMessage: string;
  rawLine: string;
}

export type ReviewRow = MessageReviewRow | MismatchReviewRow | AvailabilityReviewRow;

export interface RestaurantSummary {
  restaurantId: string;
  restaurantName: string;
  pickedUp: number;
  delivered: number;
  zoneCounts: ZoneCounts;
  outsideZoneDeliveries: number;
  outsideKilometers: number;
  outsideAmountLei: number;
  nightPickedUp: number;
  nightDelivered: number;
  nightZoneCounts: ZoneCounts;
  nightOutsideZoneDeliveries: number;
  nightOutsideKilometers: number;
  nightOutsideAmountLei: number;
  difference: number;
  nightDifference: number;
  courierCount: number;
  workMinutes: number;
  workSessionCount: number;
  workReviewCount: number;
  reviewCount: number;
  deliveryTimeSampleCount: number;
  averageDeliveryMinutes: number | null;
  medianDeliveryMinutes: number | null;
  deliveryDurationMinutesSamples: number[];
  sourceMessageIds: string[];
}

export interface DailyCourierSummary {
  id: string;
  dayKey: string;
  restaurantId: string;
  dateLabel: string;
  restaurantName: string;
  courierName: string;
  pickedUp: number;
  delivered: number;
  zoneCounts: ZoneCounts;
  outsideZoneDeliveries: number;
  outsideKilometers: number;
  outsideAmountLei: number;
  nightPickedUp: number;
  nightDelivered: number;
  nightZoneCounts: ZoneCounts;
  nightOutsideZoneDeliveries: number;
  nightOutsideKilometers: number;
  nightOutsideAmountLei: number;
  difference: number;
  nightDifference: number;
  workMinutes: number;
  workSessionCount: number;
  workReviewCount: number;
  reviewCount: number;
  deliveryTimeSampleCount: number;
  averageDeliveryMinutes: number | null;
  medianDeliveryMinutes: number | null;
  deliveryDurationMinutesSamples: number[];
  sourceMessageIds: string[];
}

export interface WorkHoursSummary {
  id: string;
  dayKey: string;
  dateLabel: string;
  sourceName: string;
  courierId: string;
  courierName: string;
  senderAliases: string[];
  workMinutes: number;
  sessionCount: number;
  reviewCount: number;
  firstStartIso: string | null;
  lastEndIso: string | null;
}

export interface ScanReport {
  interval: ScanInterval;
  options: ScanOptions;
  totalMessagesInInterval: number;
  totalAvailabilityMessagesInInterval: number;
  totalPickedUp: number;
  totalDelivered: number;
  totalZoneCounts: ZoneCounts;
  totalOutsideZoneDeliveries: number;
  totalOutsideKilometers: number;
  totalOutsideAmountLei: number;
  totalDeliveredWithoutZone: number;
  totalNightPickedUp: number;
  totalNightDelivered: number;
  totalNightZoneCounts: ZoneCounts;
  totalNightOutsideZoneDeliveries: number;
  totalNightOutsideKilometers: number;
  totalNightOutsideAmountLei: number;
  totalNightDeliveredWithoutZone: number;
  totalWorkMinutes: number;
  summaries: CourierSummary[];
  restaurantSummaries: RestaurantSummary[];
  dailyCourierSummaries: DailyCourierSummary[];
  workSummaries: WorkHoursSummary[];
  reviewRows: ReviewRow[];
}
