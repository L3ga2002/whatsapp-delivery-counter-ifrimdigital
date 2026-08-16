import type {
  AliasMap,
  ConversationLine,
  CourierSummary,
  DailyCourierSummary,
  ImportResult,
  MetricSourceRecord,
  PaidSource,
  ParsedAvailabilityMessage,
  ParsedChatFile,
  ParsedDeliveryMessage,
  ParseIssue,
  RestaurantSummary,
  ReviewRow,
  ScanInterval,
  ScanOptions,
  ScanReport,
  RestaurantSchedule,
  SourceKind,
  WorkHoursSummary,
  ZoneCounts,
} from './types';

const EXPORT_LINE_REGEX =
  /^(?<date>\d{2}\.\d{2}\.\d{4}), (?<time>\d{2}:\d{2}) - (?:(?<sender>[^:]+): )?(?<message>.*)$/;
const STATUS_REGEX = /\b(ridicat|livrat|preluat|ridica|riscat|luat|livra[țt]i)(?=\b|x\s*\d)/i;
const ALL_STATUS_REGEX = /\b(ridicat|livrat|preluat|ridica|riscat|luat|livra[țt]i)(?=\b|x\s*\d)/gi;
const DIRECT_STATUS_REGEX = /^\s*(?:[>*•-]\s*)?(?:am\s+)?(ridicat|livrat|preluat|ridica|riscat|luat|livra[țt]i)(?=\s|:|x\s*\d|\d|$)/i;
const QUANTITY_REGEX = /(?:x\s*(\d+)\b|\b(\d+)\s*x\b)/i;
const EDITED_MESSAGE_REGEX = /<\s*Acest mesaj a fost editat\s*>/i;
const ZONE_REGEX = /\bzona\s*([1-9])\b/gi;
const EXPLICIT_ZONE_QUANTITY_REGEX =
  /(?:\b(\d+)\s*x\s*zona\s*([1-9])\b|x\s*(\d+)\s*zona\s*([1-9])\b|\bzona\s*([1-9])\s*(?:x\s*)?(\d+)\b|\b(\d+)\s+(?:de\s+)?zona\s*([1-9])\b)/gi;
const KILOMETER_REGEX = /(?:\bkm\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*(?:km|kilometri?)\b)/gi;
const MONEY_REGEX = /\b(\d+(?:[.,]\d+)?)\s*(?:lei|ron)\b/gi;
const COMPLETION_REGEX = /\bcompletare(?:\s+comanda)?\b/i;
const RETURN_REGEX = /\bretur\b/i;
const POS_MARKER_REGEX = /\bpos\b/i;
const CANCELED_REGEX = /\banulat[ăa]?\b/i;
const REFUSED_REGEX = /\brefuzat[ăa]?\b/i;
const AVAILABILITY_REGEX = /\b(indisponibil|disponibil|indisp|disp|offline|online)\b/i;
const AVAILABILITY_WORDS = ['indisponibil', 'disponibil', 'offline', 'online'] as const;
const WORD_REGEX = /\b[\p{L}]{4,10}\b/giu;
const MAX_AUTOMATIC_WORK_SESSION_MINUTES = 18 * 60;
const MAX_AUTOMATIC_DELIVERY_DURATION_MINUTES = 180;
const MAX_RESTAURANT_ORDER_TO_PICKUP_MINUTES = 120;
const MAX_AUTOMATIC_ACTION_CHARACTERS = 220;
const RESTAURANT_ORDER_ADDRESS_REGEX = /\b(?:str(?:ada)?|bl(?:oc)?|sc(?:ara)?|apt(?:\.|\b)|interfon|telefon|tel(?:\.|\b)|adresa|adresă|comanda)\b/i;
const RESTAURANT_ORDER_PHONE_REGEX = /(?:\+?40|0)7\d{8}\b/;
type PaidUnitClassification =
  | { kind: 'zone'; zone: 1 | 2 | 3; explicit: boolean }
  | { kind: 'outside'; explicit: boolean; kilometers: number; amountLei: number };
type DeliveryPickup = {
  timestampMs: number;
  messageId: string;
  metricSourceId?: string;
  period: 'day' | 'night';
  classification: PaidUnitClassification;
};
type DeliveryPickupMatch = { pickup: DeliveryPickup; useForAverage: boolean };
const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  scanOrders: true,
  scanWorkHours: true,
  scanDeliveryTimes: true,
};

interface RawWhatsAppEntry {
  lineNumber: number;
  rawLine: string;
  date: string;
  time: string;
  sender?: string;
  message: string;
}

interface SourceText {
  sourceFile: string;
  text: string;
  bytes: number;
  restaurantName?: string;
}

interface StatusDetection {
  status: ParsedDeliveryMessage['status'];
  rawStatus: string;
  wasCorrected: boolean;
  source: 'status' | 'return' | 'completion';
  autoCountable: boolean;
  reviewReason?: string;
}

interface PaidClassification {
  paidQuantity: number;
  paidZoneCounts: ZoneCounts;
  paidOutsideZoneDeliveries: number;
  paidOutsideKilometers: number;
  paidOutsideAmountLei: number;
  paidSource: PaidSource;
  reviewReasons: string[];
}

interface ZoneClassification {
  zoneCounts: ZoneCounts;
  outsideZoneDeliveries: number;
  reviewReasons: string[];
}

export function parseImportedTexts(files: SourceText[]): ImportResult {
  const parsedFiles = files.map((file) =>
    parseWhatsAppExport(
      file.text,
      file.sourceFile,
      file.bytes,
      file.restaurantName ?? inferRestaurantName(file.sourceFile),
    ),
  );

  return {
    importedAtIso: new Date().toISOString(),
    files: parsedFiles,
    messages: parsedFiles.flatMap((file) => file.messages),
    availabilityMessages: parsedFiles.flatMap((file) => file.availabilityMessages),
    issues: parsedFiles.flatMap((file) => file.issues),
  };
}

export function parseWhatsAppExport(
  text: string,
  sourceFile: string,
  bytes = new TextEncoder().encode(text).byteLength,
  restaurantName = inferRestaurantName(sourceFile),
): ParsedChatFile {
  const sourceId = sourceFileId(sourceFile);
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const entries: RawWhatsAppEntry[] = [];
  const issues: ParseIssue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = EXPORT_LINE_REGEX.exec(line);
    if (!match?.groups) {
      const previous = entries[entries.length - 1];
      if (previous) {
        previous.message = `${previous.message}\n${line}`;
        previous.rawLine = `${previous.rawLine}\n${line}`;
      } else {
        issues.push({
          id: issueId(sourceFile, lineNumber, 'unparsed-leading-line'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber,
          severity: 'warning',
          message: 'Line does not match the Romanian WhatsApp export format.',
          rawLine: line,
        });
      }
      continue;
    }

    entries.push({
      lineNumber,
      rawLine: line,
      date: match.groups.date,
      time: match.groups.time,
      sender: match.groups.sender?.trim(),
      message: match.groups.message.trim(),
    });
  }

  const messages: ParsedDeliveryMessage[] = [];
  const availabilityMessages: ParsedAvailabilityMessage[] = [];
  for (const entry of entries) {
    const parsed = parseRelevantEntry(entry, sourceFile, sourceId, restaurantName);
    if (parsed.message) {
      messages.push(parsed.message);
    }
    issues.push(...parsed.issues);

    const availability = parseAvailabilityEntry(entry, sourceFile, sourceId, restaurantName);
    if (availability.message) {
      availabilityMessages.push(availability.message);
    }
    issues.push(...availability.issues);
  }

  const sourceKind = inferSourceKind(
    sourceFile,
    restaurantName,
    messages.length,
    availabilityMessages.length,
  );

  return {
    sourceId,
    sourceFile,
    restaurantName,
    sourceKind,
    bytes,
    rawLineCount: lines.filter((line) => line.trim()).length,
    parsedMessageCount: entries.length,
    relevantMessageCount: messages.length,
    conversationLines: entries.map((entry) =>
      toConversationLine(entry, sourceFile, sourceId, restaurantName),
    ),
    messages,
    availabilityMessages,
    issues,
  };
}

/**
 * For every restaurant with a night tariff, a reliable restaurant order notice
 * posted before 23:00 keeps a single later pickup on the day tariff. The restaurant
 * schedule only decides whether messages can be scanned; it never changes a tariff by
 * itself. We intentionally leave multi-order pickups unchanged when the chat cannot
 * prove a one-to-one match.
 */
export function applyRestaurantScheduleTariff(
  messages: ParsedDeliveryMessage[],
  conversationLines: ConversationLine[],
  schedule?: RestaurantSchedule,
): ParsedDeliveryMessage[] {
  if (!schedule) {
    return messages;
  }

  const courierIdentities = new Set(
    messages.map((message) => normalizeCourierIdentity(message.senderRaw)).filter(Boolean),
  );
  const notices = conversationLines
    .filter((line) => isLikelyRestaurantOrderNotice(line, courierIdentities))
    .sort((left, right) => left.timestampMs - right.timestampMs);
  if (notices.length === 0) {
    return messages;
  }

  const usedNoticeIds = new Set<string>();
  const adjusted = new Map<string, ParsedDeliveryMessage>();
  for (const message of [...messages].sort((left, right) => left.timestampMs - right.timestampMs)) {
    if (
      message.status !== 'ridicat' ||
      message.autoCountable === false ||
      message.paidQuantity !== 1 ||
      // A command posted by the restaurant before the configured closing time can
      // be picked up a few minutes later. This applies to day-only restaurants too;
      // the notice must still be a unique, verifiable match.
      !requiresRestaurantNoticeForDayTariff(message, schedule)
    ) {
      continue;
    }

    const cutoffMs = restaurantScheduleCutoffBefore(message.timestampMs, schedule);
    const candidates = notices.filter(
      (notice) =>
        !usedNoticeIds.has(notice.id) &&
        notice.timestampMs < cutoffMs &&
        notice.timestampMs < message.timestampMs &&
        message.timestampMs - notice.timestampMs <= MAX_RESTAURANT_ORDER_TO_PICKUP_MINUTES * 60_000,
    );
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        adjusted.set(message.id, appendScheduleReview(message, 'Exista mai multe comenzi ale restaurantului inainte de inchidere; tariful zi nu a fost atribuit automat.'));
      }
      continue;
    }
    const candidate = candidates[0];

    usedNoticeIds.add(candidate.id);
    adjusted.set(message.id, {
      ...message,
      period: 'day',
      reportDayKey: restaurantOperatingDayKey(candidate.timestampMs, schedule),
      usesRestaurantSchedule: true,
      tariffSourceLineId: candidate.id,
      tariffSourceLineNumber: candidate.lineNumber,
      tariffSourceTimestampIso: candidate.timestampIso,
    });
  }

  return messages.map((message) => adjusted.get(message.id) ?? message);
}

/**
 * Applies a restaurant's operating day to every retained delivery message. An overnight
 * operating day closes on the configured hour, not at a hard-coded 04:00 boundary.
 */
export function applyRestaurantScheduleContext(
  messages: ParsedDeliveryMessage[],
  conversationLines: ConversationLine[],
  schedule?: RestaurantSchedule,
): ParsedDeliveryMessage[] {
  const tariffAdjusted = applyRestaurantScheduleTariff(messages, conversationLines, schedule);
  if (!schedule) {
    return tariffAdjusted;
  }

  const nightTariff = usesNightTariff(schedule);
  const contextual = tariffAdjusted.map((message) => ({
    ...message,
    // Operating hours and tariff are independent. A 10:00-00:00 restaurant is open
    // past 23:00 but stays on the day tariff when configured as day-only.
    period: !nightTariff && isWithinRestaurantSchedule(message.timestampMs, schedule)
      ? 'day'
      : message.period,
    reportDayKey: message.tariffSourceTimestampIso
      ? restaurantOperatingDayKey(Date.parse(message.tariffSourceTimestampIso), schedule)
      : restaurantOperatingDayKey(message.timestampMs, schedule),
    usesRestaurantSchedule: true,
  }));

  return alignDeliveryWithPickupOperatingDay(contextual);
}

/**
 * Programul restaurantului filtreaza comenzile create in afara programului.
 * Livrarile din maximum trei ore de la o ridicare valida raman disponibile pentru
 * imperechere, inclusiv cand livrarea trece putin dupa ora de inchidere.
 */
export function filterMessagesForRestaurantSchedule(
  messages: ParsedDeliveryMessage[],
  schedule?: RestaurantSchedule,
): ParsedDeliveryMessage[] {
  if (!schedule) {
    return messages;
  }

  const queuedPickupsByCourier = new Map<string, number[]>();
  const accepted = new Map<string, ParsedDeliveryMessage>();
  const pickupAllowed = (message: ParsedDeliveryMessage): boolean =>
    isWithinRestaurantSchedule(message.timestampMs, schedule) ||
    Boolean(message.tariffSourceLineId);

  for (const message of [...messages].sort((left, right) => left.timestampMs - right.timestampMs)) {
    const courierId = normalizeCourierIdentity(message.senderRaw);
    if (message.status === 'ridicat') {
      if (!pickupAllowed(message)) {
        continue;
      }
      accepted.set(message.id, message);
      if (message.autoCountable !== false) {
        const queue = queuedPickupsByCourier.get(courierId) ?? [];
        for (let index = 0; index < Math.max(0, message.quantity); index += 1) {
          queue.push(message.timestampMs);
        }
        queuedPickupsByCourier.set(courierId, queue);
      }
      continue;
    }
    if (message.status !== 'livrat') {
      if (isWithinRestaurantSchedule(message.timestampMs, schedule)) {
        accepted.set(message.id, message);
      }
      continue;
    }

    const queue = queuedPickupsByCourier.get(courierId) ?? [];
    while (
      queue.length &&
      (queue[0] > message.timestampMs ||
        message.timestampMs - queue[0] > MAX_AUTOMATIC_DELIVERY_DURATION_MINUTES * 60_000)
    ) {
      queue.shift();
    }
    const requestedQuantity = Math.max(0, message.quantity);
    const matchedQuantity = Math.min(requestedQuantity, queue.length);
    if (matchedQuantity > 0) {
      queue.splice(0, matchedQuantity);
      queuedPickupsByCourier.set(courierId, queue);
    }

    if (
      isWithinRestaurantSchedule(message.timestampMs, schedule) ||
      matchedQuantity === requestedQuantity ||
      matchedQuantity > 0
    ) {
      accepted.set(
        message.id,
        matchedQuantity > 0 && matchedQuantity < requestedQuantity
          ? appendScheduleReview(
            { ...message, quantity: matchedQuantity },
            'Doar o parte din livrare se potriveste cu ridicari valide in program; verifica manual.',
          )
          : message,
      );
    }
  }

  return messages.flatMap((message) => {
    const acceptedMessage = accepted.get(message.id);
    return acceptedMessage ? [acceptedMessage] : [];
  });
}

function isWithinRestaurantSchedule(timestampMs: number, schedule: RestaurantSchedule): boolean {
  const openingMinutes = parseScheduleMinutes(schedule.openingTime);
  const closingMinutes = parseScheduleMinutes(schedule.closingTime);
  if (openingMinutes === null || closingMinutes === null) {
    return true;
  }
  const date = new Date(timestampMs);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  if (isOvernightRestaurantSchedule(schedule)) {
    return currentMinutes >= openingMinutes || currentMinutes < closingMinutes;
  }
  return currentMinutes >= openingMinutes && currentMinutes < closingMinutes;
}

function isOvernightRestaurantSchedule(schedule: RestaurantSchedule): boolean {
  const openingMinutes = parseScheduleMinutes(schedule.openingTime);
  const closingMinutes = parseScheduleMinutes(schedule.closingTime);
  // `closesNextDay` used to be persisted as a separate flag. Derive the fact from
  // the actual 24-hour values so an old/stale flag cannot turn 10:00-23:00 into an
  // overnight schedule.
  return openingMinutes !== null && closingMinutes !== null && closingMinutes < openingMinutes;
}

function usesNightTariff(schedule: RestaurantSchedule): boolean {
  if (schedule.tariffPolicy === 'day_only' || schedule.tariffPolicy === 'night_after_23') {
    return schedule.tariffPolicy === 'night_after_23';
  }

  // Compatibility with local records saved before tariffPolicy existed. Midnight is
  // a late day closing; an end time after midnight defaults to the night tariff.
  const openingMinutes = parseScheduleMinutes(schedule.openingTime);
  const closingMinutes = parseScheduleMinutes(schedule.closingTime);
  return openingMinutes !== null && closingMinutes !== null && closingMinutes > 0 && closingMinutes < openingMinutes;
}

function restaurantOperatingDayKey(timestampMs: number, schedule: RestaurantSchedule): string {
  const closingMinutes = parseScheduleMinutes(schedule.closingTime);
  if (!isOvernightRestaurantSchedule(schedule) || closingMinutes === null) {
    return localDateKey(timestampMs);
  }

  const date = new Date(timestampMs);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  if (currentMinutes <= closingMinutes) {
    date.setDate(date.getDate() - 1);
  }
  return localDateKey(date.getTime());
}

function appendScheduleReview(message: ParsedDeliveryMessage, reason: string): ParsedDeliveryMessage {
  return {
    ...message,
    confidence: 'low',
    needsReview: true,
    reviewReasons: Array.from(new Set([...message.reviewReasons, reason])),
  };
}

function alignDeliveryWithPickupOperatingDay(messages: ParsedDeliveryMessage[]): ParsedDeliveryMessage[] {
  const queues = new Map<string, Array<Pick<ParsedDeliveryMessage, 'timestampMs' | 'period' | 'reportDayKey'>>>();
  const adjusted = new Map<string, ParsedDeliveryMessage>();

  for (const message of [...messages].sort((left, right) => left.timestampMs - right.timestampMs)) {
    const key = deliveryQueueKey(
      message.restaurantName,
      normalizeCourierIdentity(message.senderRaw),
      message.reportImportId,
    );
    const queue = queues.get(key) ?? [];
    if (message.autoCountable !== false && message.status === 'ridicat') {
      const quantity = Math.max(0, positiveNumber(message.paidQuantity, 0));
      for (let index = 0; index < quantity; index += 1) {
        queue.push({ timestampMs: message.timestampMs, period: message.period, reportDayKey: message.reportDayKey });
      }
      queues.set(key, queue);
      continue;
    }
    if (message.autoCountable === false || message.status !== 'livrat') {
      continue;
    }

    const matches: Array<Pick<ParsedDeliveryMessage, 'period' | 'reportDayKey'>> = [];
    for (let index = 0; index < message.quantity; index += 1) {
      while (queue.length && message.timestampMs - queue[0].timestampMs > MAX_AUTOMATIC_DELIVERY_DURATION_MINUTES * 60_000) {
        queue.shift();
      }
      const pickup = queue[0];
      if (!pickup || pickup.timestampMs > message.timestampMs) {
        break;
      }
      queue.shift();
      matches.push(pickup);
    }
    queues.set(key, queue);
    if (!matches.length) {
      continue;
    }
    const contexts = new Set(matches.map((match) => `${match.period}:${match.reportDayKey}`));
    if (contexts.size === 1) {
      adjusted.set(message.id, { ...message, period: matches[0].period, reportDayKey: matches[0].reportDayKey });
    } else {
      adjusted.set(message.id, appendScheduleReview(message, 'Livrarea corespunde unor ridicari din zile/tarife diferite; verifica manual.'));
    }
  }

  return messages.map((message) => adjusted.get(message.id) ?? message);
}

function parseScheduleMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function buildScanReport(
  messages: ParsedDeliveryMessage[],
  interval: ScanInterval,
  aliases: AliasMap,
  availabilityMessages: ParsedAvailabilityMessage[] = [],
  options: ScanOptions = DEFAULT_SCAN_OPTIONS,
): ScanReport {
  const scanOptions = normalizeScanOptions(options);
  const fromMs = Date.parse(interval.fromIso);
  const toMs = Date.parse(interval.toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error('Intervalul selectat nu are date valide.');
  }
  if (fromMs > toMs) {
    throw new Error('Data de inceput trebuie sa fie inainte de data de final.');
  }

  const deliverySourceMessages =
    scanOptions.scanOrders || scanOptions.scanDeliveryTimes ? messages : [];
  const availabilitySourceMessages = scanOptions.scanWorkHours ? availabilityMessages : [];
  const inInterval = deliverySourceMessages
    .map(normalizeParsedDeliveryMessage)
    .filter((message) => isMessageInsideScanInterval(message, fromMs, toMs));
  const availabilityInInterval = availabilitySourceMessages.filter(
    (message) => message.timestampMs >= fromMs && message.timestampMs <= toMs,
  );
  const summaries = new Map<string, CourierSummary>();
  const restaurantSummaries = new Map<string, RestaurantSummary>();
  const dailySummaries = new Map<string, DailyCourierSummary>();
  const workSummaries = new Map<string, WorkHoursSummary>();
  const metricSources = new Map<string, MetricSourceRecord>();
  const pickupQueues = new Map<string, DeliveryPickup[]>();
  const reviewRows: ReviewRow[] = [];

  for (const message of [...inInterval].sort((a, b) => a.timestampMs - b.timestampMs)) {
    const displayName = resolveCourierName(message.senderRaw, aliases);
    const courierId = displayName.toLocaleLowerCase('ro-RO');
    const dayKey = message.reportDayKey;
    const restaurantId = message.restaurantId ?? message.restaurantName.toLocaleLowerCase('ro-RO');
    const dailyKey = `${dayKey}:${restaurantId}:${courierId}`;
    const isNight = message.period === 'night';
    const summary =
      summaries.get(courierId) ??
      ({
        courierId,
        displayName,
        senderAliases: [],
        pickedUp: 0,
        delivered: 0,
        zoneCounts: createEmptyZoneCounts(),
        outsideZoneDeliveries: 0,
        outsideKilometers: 0,
        outsideAmountLei: 0,
        deliveredWithoutZone: 0,
        nightPickedUp: 0,
        nightDelivered: 0,
        nightZoneCounts: createEmptyZoneCounts(),
        nightOutsideZoneDeliveries: 0,
        nightOutsideKilometers: 0,
        nightOutsideAmountLei: 0,
        nightDeliveredWithoutZone: 0,
        difference: 0,
        nightDifference: 0,
        workMinutes: 0,
        workSessionCount: 0,
        workReviewCount: 0,
        reviewedCount: 0,
        unclearCount: 0,
        deliveryTimeSampleCount: 0,
        averageDeliveryMinutes: null,
        medianDeliveryMinutes: null,
        deliveryDurationMinutesSamples: [],
        sourceMessageIds: [],
      } satisfies CourierSummary);
    const restaurantSummary =
      restaurantSummaries.get(restaurantId) ??
      ({
        restaurantId,
        restaurantName: message.restaurantName,
        pickedUp: 0,
        delivered: 0,
        zoneCounts: createEmptyZoneCounts(),
        outsideZoneDeliveries: 0,
        outsideKilometers: 0,
        outsideAmountLei: 0,
        nightPickedUp: 0,
        nightDelivered: 0,
        nightZoneCounts: createEmptyZoneCounts(),
        nightOutsideZoneDeliveries: 0,
        nightOutsideKilometers: 0,
        nightOutsideAmountLei: 0,
        difference: 0,
        nightDifference: 0,
        courierCount: 0,
        workMinutes: 0,
        workSessionCount: 0,
        workReviewCount: 0,
        reviewCount: 0,
        deliveryTimeSampleCount: 0,
        averageDeliveryMinutes: null,
        medianDeliveryMinutes: null,
        deliveryDurationMinutesSamples: [],
        sourceMessageIds: [],
      } satisfies RestaurantSummary);
    const dailySummary =
      dailySummaries.get(dailyKey) ??
      ({
        id: dailyKey,
        dayKey,
        restaurantId,
        dateLabel: formatDayKeyLabel(dayKey),
        restaurantName: message.restaurantName,
        courierName: displayName,
        pickedUp: 0,
        delivered: 0,
        zoneCounts: createEmptyZoneCounts(),
        outsideZoneDeliveries: 0,
        outsideKilometers: 0,
        outsideAmountLei: 0,
        nightPickedUp: 0,
        nightDelivered: 0,
        nightZoneCounts: createEmptyZoneCounts(),
        nightOutsideZoneDeliveries: 0,
        nightOutsideKilometers: 0,
        nightOutsideAmountLei: 0,
        difference: 0,
        nightDifference: 0,
        workMinutes: 0,
        workSessionCount: 0,
        workReviewCount: 0,
        reviewCount: 0,
        deliveryTimeSampleCount: 0,
        averageDeliveryMinutes: null,
        medianDeliveryMinutes: null,
        deliveryDurationMinutesSamples: [],
        sourceMessageIds: [],
      } satisfies DailyCourierSummary);

    if (!summary.senderAliases.includes(message.senderRaw)) {
      summary.senderAliases.push(message.senderRaw);
    }

    if (message.autoCountable !== false && message.status === 'ridicat') {
      const paidUnits = buildPaidUnits(message);
      if (scanOptions.scanOrders) {
        for (const [index, unit] of paidUnits.entries()) {
          applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, message.period, unit, 1);
          const metricSourceId = `metric-${message.id}-${index}`;
          metricSources.set(metricSourceId, createMetricSourceRecord(
            metricSourceId,
            message,
            displayName,
            unit,
          ));
        }
      }
      if (scanOptions.scanOrders || scanOptions.scanDeliveryTimes) {
        const queueKey = deliveryQueueKey(message.restaurantName, courierId, message.reportImportId);
        const queue = pickupQueues.get(queueKey) ?? [];
        queue.push(...paidUnits.map((unit, index) => ({
          timestampMs: message.timestampMs,
          messageId: message.id,
          metricSourceId: scanOptions.scanOrders ? `metric-${message.id}-${index}` : undefined,
          period: message.period,
          classification: unit,
        })));
        pickupQueues.set(queueKey, queue);
      }
    } else if (message.autoCountable !== false) {
      if (scanOptions.scanOrders || scanOptions.scanDeliveryTimes) {
        const queueKey = deliveryQueueKey(message.restaurantName, courierId, message.reportImportId);
        const queue = pickupQueues.get(queueKey) ?? [];
        const deliveryUnits = buildDeliveryClassificationUnits(message);
        let returnLocationPeriod: 'day' | 'night' | null = null;
        let returnLocationDayKey: string | null = null;
        for (let count = 0; count < message.quantity; count += 1) {
          const pickupMatch = takePickupForDelivery(queue, message.timestampMs, message.id, displayName, reviewRows);
          const deliveryPeriod = pickupMatch?.pickup.period ?? message.period;
          if (returnLocationPeriod === null && pickupMatch) {
            returnLocationPeriod = pickupMatch.pickup.period;
            returnLocationDayKey = reportDayKey(pickupMatch.pickup.timestampMs);
          }
          const deliveryUnit = deliveryUnits[count] ?? null;
          if (scanOptions.scanOrders) {
            if (deliveryPeriod === 'night') {
              summary.nightDelivered += 1;
              restaurantSummary.nightDelivered += 1;
              dailySummary.nightDelivered += 1;
            } else {
              summary.delivered += 1;
              restaurantSummary.delivered += 1;
              dailySummary.delivered += 1;
            }
            if (pickupMatch && deliveryUnit) {
              reconcileDeliveryClassification(
                pickupMatch.pickup,
                deliveryUnit,
                summary,
                restaurantSummary,
                dailySummary,
                message,
                displayName,
                reviewRows,
              );
            }
            if (pickupMatch) {
              updateMetricSourceDelivery(metricSources, pickupMatch.pickup, message);
            }
          }

          if (scanOptions.scanDeliveryTimes && pickupMatch?.useForAverage) {
            const minutes = (message.timestampMs - pickupMatch.pickup.timestampMs) / 60_000;
            addDeliveryDuration(summary, minutes);
            addDeliveryDuration(restaurantSummary, minutes);
            addDeliveryDuration(dailySummary, minutes);
          }
        }
        if (scanOptions.scanOrders) {
          const returnLocationUnits = buildPaidReturnLocationUnits(message);
          for (const [index, unit] of returnLocationUnits.entries()) {
            const period = returnLocationPeriod ?? message.period;
            applyPaidReturnLocationUnitToSummaries(
              summary,
              restaurantSummary,
              dailySummary,
              period,
              unit,
            );
            const metricSourceId = `metric-return-location-${message.id}-${index}`;
            metricSources.set(metricSourceId, createReturnLocationMetricSourceRecord(
              metricSourceId,
              message,
              displayName,
              unit,
              period,
              returnLocationDayKey ?? message.reportDayKey,
            ));
          }
        }
        pickupQueues.set(queueKey, queue);
      } else if (isNight && scanOptions.scanOrders) {
        summary.nightDelivered += message.quantity;
        restaurantSummary.nightDelivered += message.quantity;
        dailySummary.nightDelivered += message.quantity;
      } else if (scanOptions.scanOrders) {
        summary.delivered += message.quantity;
        restaurantSummary.delivered += message.quantity;
        dailySummary.delivered += message.quantity;
      }
    }
    summary.sourceMessageIds.push(message.id);
    restaurantSummary.sourceMessageIds.push(message.id);
    dailySummary.sourceMessageIds.push(message.id);

    if (message.needsReview && (scanOptions.scanOrders || scanOptions.scanDeliveryTimes)) {
      summary.reviewedCount += 1;
      summary.unclearCount += 1;
      reviewRows.push({
        kind: 'message',
        id: `review-${message.id}`,
        messageId: message.id,
        severity: message.confidence === 'low' ? 'error' : 'warning',
        sourceId: message.sourceId,
        sourceFile: message.sourceFile,
        lineNumber: message.lineNumber,
        restaurantName: message.restaurantName,
        courierName: displayName,
        timestampIso: message.timestampIso,
        status: message.status,
        quantity: message.quantity,
        reason: message.reviewReasons.join('; '),
        originalMessage: message.originalMessage,
        rawLine: message.rawLine,
      });
      restaurantSummary.reviewCount += 1;
      dailySummary.reviewCount += 1;
    }

    summaries.set(courierId, summary);
    restaurantSummaries.set(restaurantId, restaurantSummary);
    dailySummaries.set(dailyKey, dailySummary);
  }

  const openAvailability = new Map<string, ParsedAvailabilityMessage>();
  const availabilityUntilIntervalEnd = availabilitySourceMessages;
  for (const availability of [...availabilityUntilIntervalEnd].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (!availability.senderRaw) {
      continue;
    }

    const displayName = resolveCourierName(availability.senderRaw, aliases);
    const courierId = displayName.toLocaleLowerCase('ro-RO');
    const availabilityKey = `${availability.sourceId}:${courierId}`;
    const isInsideInterval = availability.timestampMs >= fromMs && availability.timestampMs <= toMs;

    if (availability.needsReview && isInsideInterval) {
      reviewRows.push({
        kind: 'availability',
        id: `availability-review-${availability.id}`,
        severity: 'warning',
        sourceId: availability.sourceId,
        sourceFile: availability.sourceFile,
        lineNumber: availability.lineNumber,
        restaurantName: availability.restaurantName,
        courierName: displayName,
        timestampIso: availability.timestampIso,
        status: availability.status,
        reason: availability.reviewReasons.join('; '),
        originalMessage: availability.originalMessage,
        rawLine: availability.rawLine,
      });
      markWorkReview(
        availability,
        displayName,
        courierId,
        availability.timestampMs,
        summaries,
        workSummaries,
      );
    }

    if (!availability.usableForWorkHours) {
      continue;
    }

    if (availability.status === 'disponibil') {
      const existing = openAvailability.get(availabilityKey);
      if (existing && isInsideInterval) {
        reviewRows.push({
          kind: 'availability',
          id: `availability-duplicate-${availability.id}`,
          severity: 'warning',
          sourceId: availability.sourceId,
          sourceFile: availability.sourceFile,
          lineNumber: availability.lineNumber,
          restaurantName: availability.restaurantName,
          courierName: displayName,
          timestampIso: availability.timestampIso,
          status: availability.status,
          reason: 'Livratorul a scris disponibil de doua ori fara indisponibil intre mesaje.',
          originalMessage: availability.originalMessage,
          rawLine: availability.rawLine,
        });
        markWorkReview(
          availability,
          displayName,
          courierId,
          availability.timestampMs,
          summaries,
          workSummaries,
        );
      }
      openAvailability.set(availabilityKey, availability);
      continue;
    }

    const start = openAvailability.get(availabilityKey);
    if (!start) {
      if (isInsideInterval) {
        reviewRows.push({
          kind: 'availability',
          id: `availability-unmatched-${availability.id}`,
          severity: 'warning',
          sourceId: availability.sourceId,
          sourceFile: availability.sourceFile,
          lineNumber: availability.lineNumber,
          restaurantName: availability.restaurantName,
          courierName: displayName,
          timestampIso: availability.timestampIso,
          status: availability.status,
          reason: 'Indisponibil fara un mesaj disponibil anterior pentru acelasi livrator.',
          originalMessage: availability.originalMessage,
          rawLine: availability.rawLine,
        });
        markWorkReview(
          availability,
          displayName,
          courierId,
          availability.timestampMs,
          summaries,
          workSummaries,
        );
      }
      continue;
    }

    if (availability.timestampMs <= start.timestampMs) {
      if (isInsideInterval) {
        reviewRows.push({
          kind: 'availability',
          id: `availability-inverted-${availability.id}`,
          severity: 'warning',
          sourceId: availability.sourceId,
          sourceFile: availability.sourceFile,
          lineNumber: availability.lineNumber,
          restaurantName: availability.restaurantName,
          courierName: displayName,
          timestampIso: availability.timestampIso,
          status: availability.status,
          reason: 'Interval disponibil/indisponibil invalid; mesajul de final este inaintea celui de start.',
          originalMessage: availability.originalMessage,
          rawLine: availability.rawLine,
        });
        markWorkReview(
          availability,
          displayName,
          courierId,
          availability.timestampMs,
          summaries,
          workSummaries,
        );
      }
      openAvailability.delete(availabilityKey);
      continue;
    }

    const rawSessionMinutes = (availability.timestampMs - start.timestampMs) / 60_000;
    const sessionIntersectsInterval = availability.timestampMs >= fromMs && start.timestampMs <= toMs;
    if (rawSessionMinutes > MAX_AUTOMATIC_WORK_SESSION_MINUTES) {
      if (!sessionIntersectsInterval) {
        openAvailability.delete(availabilityKey);
        continue;
      }

      const reviewTimestampMs = Math.max(Math.min(availability.timestampMs, toMs), fromMs);
      reviewRows.push({
        kind: 'availability',
        id: `availability-too-long-${availability.id}`,
        severity: 'warning',
        sourceId: availability.sourceId,
        sourceFile: availability.sourceFile,
        lineNumber: availability.lineNumber,
        restaurantName: availability.restaurantName,
        courierName: displayName,
        timestampIso: availability.timestampIso,
        status: availability.status,
        reason:
          'Intervalul Disponibil/Indisponibil depaseste 18 ore; probabil lipseste un mesaj si nu este folosit automat la calcul.',
        originalMessage: availability.originalMessage,
        rawLine: availability.rawLine,
      });
      markWorkReview(
        availability,
        displayName,
        courierId,
        reviewTimestampMs,
        summaries,
        workSummaries,
      );
      openAvailability.delete(availabilityKey);
      continue;
    }

    const clippedStartMs = Math.max(start.timestampMs, fromMs);
    const clippedEndMs = Math.min(availability.timestampMs, toMs);
    if (clippedEndMs > clippedStartMs) {
      addWorkSession(
        start,
        availability,
        clippedStartMs,
        clippedEndMs,
        displayName,
        courierId,
        summaries,
        workSummaries,
      );
    }
    openAvailability.delete(availabilityKey);
  }

  for (const [availabilityKey, start] of openAvailability.entries()) {
    const displayName = resolveCourierName(start.senderRaw, aliases);
    const courierId = displayName.toLocaleLowerCase('ro-RO');
    const openSessionIntersectsInterval = start.timestampMs <= toMs;
    if (!openSessionIntersectsInterval) {
      continue;
    }

    reviewRows.push({
      kind: 'availability',
      id: `availability-open-${availabilityKey}-${start.id}`,
      severity: 'warning',
      sourceId: start.sourceId,
      sourceFile: start.sourceFile,
      lineNumber: start.lineNumber,
      restaurantName: start.restaurantName,
      courierName: displayName,
      timestampIso: start.timestampIso,
      status: start.status,
      reason: 'Disponibil fara un mesaj indisponibil ulterior pentru acelasi livrator.',
      originalMessage: start.originalMessage,
      rawLine: start.rawLine,
    });
    markWorkReview(start, displayName, courierId, Math.max(start.timestampMs, fromMs), summaries, workSummaries);
  }

  const summaryRows = Array.from(summaries.values()).map((summary) => {
    return {
      ...summary,
      deliveredWithoutZone: Math.max(
        0,
        summary.pickedUp - sumZoneCounts(summary.zoneCounts) - summary.outsideZoneDeliveries,
      ),
      nightDeliveredWithoutZone: Math.max(
        0,
        summary.nightPickedUp - sumZoneCounts(summary.nightZoneCounts) - summary.nightOutsideZoneDeliveries,
      ),
      difference: summary.pickedUp - summary.delivered,
      nightDifference: summary.nightPickedUp - summary.nightDelivered,
      averageDeliveryMinutes: calculateAverageDeliveryMinutes(summary),
      medianDeliveryMinutes: calculateMedianDeliveryMinutes(summary),
    };
  });
  const restaurantRows = Array.from(restaurantSummaries.values()).map((summary) => {
    const courierIds = new Set(
      inInterval
        .filter((message) => message.restaurantName === summary.restaurantName)
        .map((message) => resolveCourierName(message.senderRaw, aliases).toLocaleLowerCase('ro-RO')),
    );
    return {
      ...summary,
      deliveredWithoutZone: Math.max(
        0,
        summary.pickedUp - sumZoneCounts(summary.zoneCounts) - summary.outsideZoneDeliveries,
      ),
      nightDeliveredWithoutZone: Math.max(
        0,
        summary.nightPickedUp - sumZoneCounts(summary.nightZoneCounts) - summary.nightOutsideZoneDeliveries,
      ),
      difference: summary.pickedUp - summary.delivered,
      nightDifference: summary.nightPickedUp - summary.nightDelivered,
      courierCount: courierIds.size,
      averageDeliveryMinutes: calculateAverageDeliveryMinutes(summary),
      medianDeliveryMinutes: calculateMedianDeliveryMinutes(summary),
    };
  });
  const dailyRows = Array.from(dailySummaries.values()).map((summary) => ({
    ...summary,
    deliveredWithoutZone: Math.max(
      0,
      summary.pickedUp - sumZoneCounts(summary.zoneCounts) - summary.outsideZoneDeliveries,
    ),
    nightDeliveredWithoutZone: Math.max(
      0,
      summary.nightPickedUp - sumZoneCounts(summary.nightZoneCounts) - summary.nightOutsideZoneDeliveries,
    ),
    difference: summary.pickedUp - summary.delivered,
    nightDifference: summary.nightPickedUp - summary.nightDelivered,
    averageDeliveryMinutes: calculateAverageDeliveryMinutes(summary),
    medianDeliveryMinutes: calculateMedianDeliveryMinutes(summary),
  }));
  const workRows = Array.from(workSummaries.values()).sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      a.courierName.localeCompare(b.courierName, 'ro-RO') ||
      a.sourceName.localeCompare(b.sourceName, 'ro-RO'),
  );

  for (const summary of summaryRows) {
    if (scanOptions.scanOrders && summary.difference !== 0) {
      reviewRows.push({
        kind: 'mismatch',
        id: `mismatch-${summary.courierId}`,
        severity: 'warning',
        courierName: summary.displayName,
        pickedUp: summary.pickedUp,
        delivered: summary.delivered,
        difference: summary.difference,
        reason:
          summary.difference > 0
            ? 'Ridicari mai multe decat livrari in interval.'
            : 'Livrari mai multe decat ridicari in interval.',
        sourceMessageIds: summary.sourceMessageIds,
      });
    }

    if (scanOptions.scanOrders && summary.nightDifference !== 0) {
      reviewRows.push({
        kind: 'mismatch',
        id: `mismatch-night-${summary.courierId}`,
        severity: 'warning',
        courierName: summary.displayName,
        pickedUp: summary.nightPickedUp,
        delivered: summary.nightDelivered,
        difference: summary.nightDifference,
        reason:
          summary.nightDifference > 0
            ? 'Ridicari de noapte mai multe decat livrari de noapte in interval.'
            : 'Livrari de noapte mai multe decat ridicari de noapte in interval.',
        sourceMessageIds: summary.sourceMessageIds,
      });
    }
  }

  return {
    interval,
    options: scanOptions,
    totalMessagesInInterval: inInterval.length,
    totalAvailabilityMessagesInInterval: availabilityInInterval.length,
    totalPickedUp: summaryRows.reduce((total, summary) => total + summary.pickedUp, 0),
    totalDelivered: summaryRows.reduce((total, summary) => total + summary.delivered, 0),
    totalZoneCounts: summaryRows.reduce((totals, summary) => {
      addZoneCounts(totals, summary.zoneCounts);
      return totals;
    }, createEmptyZoneCounts()),
    totalOutsideZoneDeliveries: summaryRows.reduce(
      (total, summary) => total + summary.outsideZoneDeliveries,
      0,
    ),
    totalOutsideKilometers: summaryRows.reduce(
      (total, summary) => total + summary.outsideKilometers,
      0,
    ),
    totalOutsideAmountLei: summaryRows.reduce(
      (total, summary) => total + summary.outsideAmountLei,
      0,
    ),
    totalDeliveredWithoutZone: summaryRows.reduce(
      (total, summary) => total + summary.deliveredWithoutZone,
      0,
    ),
    totalNightPickedUp: summaryRows.reduce((total, summary) => total + summary.nightPickedUp, 0),
    totalNightDelivered: summaryRows.reduce((total, summary) => total + summary.nightDelivered, 0),
    totalNightZoneCounts: summaryRows.reduce((totals, summary) => {
      addZoneCounts(totals, summary.nightZoneCounts);
      return totals;
    }, createEmptyZoneCounts()),
    totalNightOutsideZoneDeliveries: summaryRows.reduce(
      (total, summary) => total + summary.nightOutsideZoneDeliveries,
      0,
    ),
    totalNightOutsideKilometers: summaryRows.reduce(
      (total, summary) => total + summary.nightOutsideKilometers,
      0,
    ),
    totalNightOutsideAmountLei: summaryRows.reduce(
      (total, summary) => total + summary.nightOutsideAmountLei,
      0,
    ),
    totalNightDeliveredWithoutZone: summaryRows.reduce(
      (total, summary) => total + summary.nightDeliveredWithoutZone,
      0,
    ),
    totalWorkMinutes: workRows.reduce((total, summary) => total + summary.workMinutes, 0),
    summaries: summaryRows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ro-RO')),
    restaurantSummaries: restaurantRows.sort((a, b) =>
      a.restaurantName.localeCompare(b.restaurantName, 'ro-RO'),
    ),
    dailyCourierSummaries: dailyRows.sort(
      (a, b) =>
        a.dayKey.localeCompare(b.dayKey) ||
        a.restaurantName.localeCompare(b.restaurantName, 'ro-RO') ||
        a.courierName.localeCompare(b.courierName, 'ro-RO'),
    ),
    workSummaries: workRows,
    metricSources: Array.from(metricSources.values()).sort(
      (left, right) =>
        left.pickupTimestampIso.localeCompare(right.pickupTimestampIso) || left.id.localeCompare(right.id),
    ),
    reviewRows,
  };
}

function createMetricSourceRecord(
  id: string,
  pickup: ParsedDeliveryMessage,
  courierName: string,
  unit: PaidUnitClassification,
): MetricSourceRecord {
  return {
    id,
    period: pickup.period,
    classification: metricClassification(unit),
    restaurantId: pickup.restaurantId,
    restaurantName: pickup.restaurantName,
    courierName,
    dayKey: pickup.reportDayKey,
    reportImportId: pickup.reportImportId,
    pickupMessageId: pickup.id,
    pickupSourceId: pickup.sourceId,
    pickupSourceFile: pickup.sourceFile,
    pickupLineNumber: pickup.lineNumber,
    pickupTimestampIso: pickup.timestampIso,
    pickupMessage: pickup.originalMessage,
  };
}

function createReturnLocationMetricSourceRecord(
  id: string,
  delivery: ParsedDeliveryMessage,
  courierName: string,
  unit: PaidUnitClassification,
  period: 'day' | 'night',
  dayKey: string,
): MetricSourceRecord {
  const source = createMetricSourceRecord(id, delivery, courierName, unit);
  return {
    ...source,
    period,
    dayKey,
    deliveryMessageId: delivery.id,
    deliveryReportImportId: delivery.reportImportId,
    deliverySourceId: delivery.sourceId,
    deliverySourceFile: delivery.sourceFile,
    deliveryLineNumber: delivery.lineNumber,
    deliveryTimestampIso: delivery.timestampIso,
    deliveryMessage: delivery.originalMessage,
  };
}

function updateMetricSourceDelivery(
  metricSources: Map<string, MetricSourceRecord>,
  pickup: DeliveryPickup,
  delivery: ParsedDeliveryMessage,
): void {
  if (!pickup.metricSourceId) return;
  const source = metricSources.get(pickup.metricSourceId);
  if (!source) return;
  source.classification = metricClassification(pickup.classification);
  source.deliveryMessageId = delivery.id;
  source.deliveryReportImportId = delivery.reportImportId;
  source.deliverySourceId = delivery.sourceId;
  source.deliverySourceFile = delivery.sourceFile;
  source.deliveryLineNumber = delivery.lineNumber;
  source.deliveryTimestampIso = delivery.timestampIso;
  source.deliveryMessage = delivery.originalMessage;
}

function metricClassification(unit: PaidUnitClassification): MetricSourceRecord['classification'] {
  if (unit.kind === 'outside') return 'special';
  return `zone${unit.zone}` as MetricSourceRecord['classification'];
}

function normalizeScanOptions(options: ScanOptions): ScanOptions {
  return {
    scanOrders: Boolean(options.scanOrders),
    scanWorkHours: Boolean(options.scanWorkHours),
    scanDeliveryTimes: Boolean(options.scanDeliveryTimes),
    includeAllRestaurants: options.includeAllRestaurants !== false,
    restaurantIds: Array.isArray(options.restaurantIds) ? options.restaurantIds : [],
  };
}

function addWorkSession(
  start: ParsedAvailabilityMessage,
  end: ParsedAvailabilityMessage,
  clippedStartMs: number,
  clippedEndMs: number,
  displayName: string,
  courierId: string,
  summaries: Map<string, CourierSummary>,
  workSummaries: Map<string, WorkHoursSummary>,
): void {
  const summary = getOrCreateCourierSummary(summaries, courierId, displayName);
  addSenderAlias(summary, start.senderRaw);
  addSenderAlias(summary, end.senderRaw);

  let addedAnySegment = false;
  for (const segment of splitWorkSessionByDay(clippedStartMs, clippedEndMs)) {
    const minutes = (segment.endMs - segment.startMs) / 60_000;
    if (minutes <= 0) {
      continue;
    }

    const workSummary = getOrCreateWorkSummary(
      workSummaries,
      start.sourceId,
      start.restaurantName,
      courierId,
      displayName,
      start.senderRaw,
      segment.dayKey,
    );
    workSummary.workMinutes += minutes;
    workSummary.sessionCount += 1;
    workSummary.firstStartIso = minIso(workSummary.firstStartIso, new Date(segment.startMs).toISOString());
    workSummary.lastEndIso = maxIso(workSummary.lastEndIso, new Date(segment.endMs).toISOString());

    summary.workMinutes += minutes;
    addedAnySegment = true;
  }

  if (addedAnySegment) {
    summary.workSessionCount += 1;
  }
}

function markWorkReview(
  availability: ParsedAvailabilityMessage,
  displayName: string,
  courierId: string,
  reviewTimestampMs: number,
  summaries: Map<string, CourierSummary>,
  workSummaries: Map<string, WorkHoursSummary>,
): void {
  const summary = getOrCreateCourierSummary(summaries, courierId, displayName);
  addSenderAlias(summary, availability.senderRaw);
  summary.workReviewCount += 1;

  const dayKey = localDateKey(reviewTimestampMs);
  const workSummary = getOrCreateWorkSummary(
    workSummaries,
    availability.sourceId,
    availability.restaurantName,
    courierId,
    displayName,
    availability.senderRaw,
    dayKey,
  );
  workSummary.reviewCount += 1;
}

function getOrCreateCourierSummary(
  summaries: Map<string, CourierSummary>,
  courierId: string,
  displayName: string,
): CourierSummary {
  const existing = summaries.get(courierId);
  if (existing) {
    return existing;
  }

  const summary = {
    courierId,
    displayName,
    senderAliases: [],
    pickedUp: 0,
    delivered: 0,
    zoneCounts: createEmptyZoneCounts(),
    outsideZoneDeliveries: 0,
    outsideKilometers: 0,
    outsideAmountLei: 0,
    deliveredWithoutZone: 0,
    nightPickedUp: 0,
    nightDelivered: 0,
    nightZoneCounts: createEmptyZoneCounts(),
    nightOutsideZoneDeliveries: 0,
    nightOutsideKilometers: 0,
    nightOutsideAmountLei: 0,
    nightDeliveredWithoutZone: 0,
    difference: 0,
    nightDifference: 0,
    workMinutes: 0,
    workSessionCount: 0,
    workReviewCount: 0,
    reviewedCount: 0,
    unclearCount: 0,
    deliveryTimeSampleCount: 0,
    averageDeliveryMinutes: null,
    medianDeliveryMinutes: null,
    deliveryDurationMinutesSamples: [],
    sourceMessageIds: [],
  } satisfies CourierSummary;
  summaries.set(courierId, summary);
  return summary;
}

function getOrCreateWorkSummary(
  workSummaries: Map<string, WorkHoursSummary>,
  sourceId: string,
  sourceName: string,
  courierId: string,
  courierName: string,
  senderRaw: string,
  dayKey: string,
): WorkHoursSummary {
  const key = `${dayKey}:${sourceId}:${courierId}`;
  const existing = workSummaries.get(key);
  if (existing) {
    if (!existing.senderAliases.includes(senderRaw)) {
      existing.senderAliases.push(senderRaw);
    }
    return existing;
  }

  const summary = {
    id: key,
    dayKey,
    dateLabel: formatDayKeyLabel(dayKey),
    sourceName,
    courierId,
    courierName,
    senderAliases: [senderRaw],
    workMinutes: 0,
    sessionCount: 0,
    reviewCount: 0,
    firstStartIso: null,
    lastEndIso: null,
  } satisfies WorkHoursSummary;
  workSummaries.set(key, summary);
  return summary;
}

function splitWorkSessionByDay(startMs: number, endMs: number): Array<{
  dayKey: string;
  startMs: number;
  endMs: number;
}> {
  const segments: Array<{ dayKey: string; startMs: number; endMs: number }> = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const dayKey = localDateKey(cursor);
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(endMs, nextDay.getTime());
    segments.push({ dayKey, startMs: cursor, endMs: segmentEnd });
    cursor = segmentEnd;
  }

  return segments;
}

function addSenderAlias(summary: CourierSummary, senderRaw: string): void {
  if (!summary.senderAliases.includes(senderRaw)) {
    summary.senderAliases.push(senderRaw);
  }
}

function minIso(current: string | null, next: string): string {
  if (!current || Date.parse(next) < Date.parse(current)) {
    return next;
  }

  return current;
}

function maxIso(current: string | null, next: string): string {
  if (!current || Date.parse(next) > Date.parse(current)) {
    return next;
  }

  return current;
}

export function resolveCourierName(senderRaw: string, aliases: AliasMap): string {
  const alias = aliases[senderRaw]?.trim();
  if (alias) return alias;

  const senderIdentity = normalizeCourierIdentity(senderRaw);
  if (!senderIdentity) return senderRaw;
  for (const [savedAlias, displayName] of Object.entries(aliases)) {
    if (normalizeCourierIdentity(savedAlias) === senderIdentity && displayName.trim()) {
      return displayName.trim();
    }
  }
  return senderRaw;
}

export function normalizeCourierIdentity(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  const looksLikePhone = /^[+\d\s().-]+$/.test(trimmed) && digits.length >= 9;
  if (looksLikePhone) {
    let normalized = digits.startsWith('00') ? digits.slice(2) : digits;
    if (normalized.length === 10 && normalized.startsWith('0')) normalized = `40${normalized.slice(1)}`;
    if (normalized.length === 9 && normalized.startsWith('7')) normalized = `40${normalized}`;
    return `phone:${normalized}`;
  }

  return `text:${trimmed.toLocaleLowerCase('ro-RO').replace(/\s+/g, ' ')}`;
}

export function isLikelyPhoneSender(senderRaw: string): boolean {
  const compact = senderRaw.replace(/[\s().-]/g, '');
  return /^\+?\d{8,15}$/.test(compact);
}

function parseRelevantEntry(
  entry: RawWhatsAppEntry,
  sourceFile: string,
  sourceId: string,
  restaurantName: string,
): { message?: ParsedDeliveryMessage; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const timestampMs = parseRomanianTimestamp(entry.date, entry.time);
  if (!Number.isFinite(timestampMs)) {
    return {
      issues: [
        {
          id: issueId(sourceFile, entry.lineNumber, 'invalid-date'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber: entry.lineNumber,
          severity: 'warning',
          message: 'Timestamp invalid in WhatsApp export line.',
          rawLine: entry.rawLine,
        },
      ],
    };
  }

  const statusDetection = detectStatus(entry.message);
  if (!statusDetection) {
    return { issues };
  }

  if (!entry.sender) {
    return {
      issues: [
        {
          id: issueId(sourceFile, entry.lineNumber, 'missing-sender'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber: entry.lineNumber,
          severity: 'warning',
          message: 'Relevant delivery status found, but sender is missing.',
          rawLine: entry.rawLine,
        },
      ],
    };
  }

  const reviewReasons: string[] = [];
  const autoCountable = statusDetection.autoCountable !== false;
  if (!autoCountable && statusDetection.reviewReason) {
    reviewReasons.push(statusDetection.reviewReason);
  }
  const quantityMatch = QUANTITY_REGEX.exec(entry.message);
  const implicitQuantity = quantityMatch
    ? null
    : detectImplicitQuantity(entry.message, statusDetection.rawStatus);
  const hasMoneyAmount = containsMoneyAmount(entry.message);
  const hasZoneMention = containsZoneMention(entry.message);
  const hasDirectCompletion = statusDetection.source === 'completion' || isDirectCompletionAction(entry.message);
  const hasCompletion = containsCompletionMention(entry.message) || hasDirectCompletion;
  const hasDirectReturn = statusDetection.source === 'return' || isDirectReturnAction(entry.message);
  const hasActionContext =
    Boolean(quantityMatch) ||
    Boolean(implicitQuantity) ||
    hasMoneyAmount ||
    hasZoneMention ||
    hasCompletion ||
    hasDirectReturn ||
    POS_MARKER_REGEX.test(entry.message);
  if (
    isConversationalStatusReference(
      entry.message,
      statusDetection.rawStatus,
      hasActionContext,
      hasMoneyAmount,
    )
  ) {
    return {
      issues: [
        {
          id: issueId(sourceFile, entry.lineNumber, 'conversational-status-reference'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber: entry.lineNumber,
          severity: 'info',
          message: 'Status mentionat intr-o intrebare sau conversatie; nu a fost numarat ca livrare/ridicare.',
          rawLine: entry.rawLine,
        },
      ],
    };
  }

  if (statusDetection.wasCorrected) {
    reviewReasons.push(
      `Status corectat automat din "${statusDetection.rawStatus}" in "${statusDetection.status}".`,
    );
  }
  if (hasGluedStatusQuantity(entry.message, statusDetection.rawStatus)) {
    reviewReasons.push('Status si cantitate scrise lipit; mesajul a fost numarat automat.');
  }
  if (statusDetection.source === 'completion') {
    reviewReasons.push('Completare fara cuvantul ridicat; numarata ca ridicare platita.');
  }

  const quantity = quantityMatch ? parseQuantityMatch(quantityMatch) : implicitQuantity?.quantity ?? 1;
  let confidence: ParsedDeliveryMessage['confidence'] = quantityMatch ? 'high' : 'medium';
  if (statusDetection.wasCorrected) {
    confidence = 'medium';
  }

  if (implicitQuantity) {
    reviewReasons.push(implicitQuantity.reviewReason);
  } else if (!quantityMatch && shouldReviewMissingQuantity(statusDetection.status, hasMoneyAmount, hasZoneMention, hasCompletion, hasDirectReturn)) {
    reviewReasons.push('Status gasit fara cantitate clara; MVP il numara ca x1.');
  }

  const statuses = Array.from(entry.message.matchAll(ALL_STATUS_REGEX), (match) =>
    match[1].toLowerCase(),
  );
  if (new Set(statuses).size > 1 || statuses.length > 1) {
    confidence = 'low';
    reviewReasons.push('Mesajul contine mai multe statusuri si trebuie verificat.');
  }

  if (EDITED_MESSAGE_REGEX.test(entry.message)) {
    reviewReasons.push('Mesaj editat in WhatsApp.');
  }

  const timestampIso = new Date(timestampMs).toISOString();
  const status = statusDetection.status;
  const period = isNightTimestamp(timestampMs) ? 'night' : 'day';
  const paidReturnLocationQuantity = detectPaidReturnLocationQuantity(entry.message, status);
  const zoneResult = detectDeliveryZones(entry.message, status, quantity);
  reviewReasons.push(...zoneResult.reviewReasons);
  const outsideKilometers = detectOutsideKilometers(entry.message);
  const outsideAmountLei = detectOutsideAmountLei(entry.message);
  const paidClassification = autoCountable
    ? classifyPaidDelivery(
      entry.message,
      status,
      quantity,
      hasDirectReturn,
      hasCompletion,
    )
    : createEmptyPaidClassification();
  reviewReasons.push(...paidClassification.reviewReasons);
  if (status === 'livrat' && outsideAmountLei > 0) {
    reviewReasons.push('Mesajul livrat mentioneaza suma in lei; este tratat ca verificare, nu dubleaza plata.');
  }
  const note = extractNote(entry.message);

  return {
    message: {
      id: messageId(sourceFile, entry.lineNumber, entry.rawLine),
      sourceId,
      sourceFile,
      restaurantName,
      lineNumber: entry.lineNumber,
      timestampIso,
      timestampMs,
      senderRaw: entry.sender,
      status,
      period,
      reportDayKey: reportDayKey(timestampMs),
      autoCountable,
      quantity,
      zoneCounts: zoneResult.zoneCounts,
      outsideKilometers,
      outsideAmountLei,
      paidQuantity: paidClassification.paidQuantity,
      paidZoneCounts: paidClassification.paidZoneCounts,
      paidOutsideZoneDeliveries: paidClassification.paidOutsideZoneDeliveries,
      paidOutsideKilometers: paidClassification.paidOutsideKilometers,
      paidOutsideAmountLei: paidClassification.paidOutsideAmountLei,
      paidSource: paidClassification.paidSource,
      paidReturnLocationQuantity,
      note,
      confidence,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
      originalMessage: entry.message,
      rawLine: entry.rawLine,
    },
    issues,
  };
}

function parseAvailabilityEntry(
  entry: RawWhatsAppEntry,
  sourceFile: string,
  sourceId: string,
  restaurantName: string,
): { message?: ParsedAvailabilityMessage; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const detection = detectAvailability(entry.message);
  if (!detection) {
    return { issues };
  }

  const timestampMs = parseRomanianTimestamp(entry.date, entry.time);
  if (!Number.isFinite(timestampMs)) {
    return {
      issues: [
        {
          id: issueId(sourceFile, entry.lineNumber, 'invalid-availability-date'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber: entry.lineNumber,
          severity: 'warning',
          message: 'Timestamp invalid pentru mesaj disponibil/indisponibil.',
          rawLine: entry.rawLine,
        },
      ],
    };
  }

  if (!entry.sender) {
    return {
      issues: [
        {
          id: issueId(sourceFile, entry.lineNumber, 'availability-missing-sender'),
          sourceId,
          sourceFile,
          restaurantName,
          lineNumber: entry.lineNumber,
          severity: 'warning',
          message: 'Mesaj disponibil/indisponibil gasit, dar senderul lipseste.',
          rawLine: entry.rawLine,
        },
      ],
    };
  }

  return {
    message: {
      id: availabilityMessageId(sourceFile, entry.lineNumber, entry.rawLine),
      sourceId,
      sourceFile,
      restaurantName,
      lineNumber: entry.lineNumber,
      timestampIso: new Date(timestampMs).toISOString(),
      timestampMs,
      senderRaw: entry.sender,
      status: detection.status,
      confidence: detection.needsReview ? 'medium' : 'high',
      usableForWorkHours: detection.usableForWorkHours,
      needsReview: detection.needsReview,
      reviewReasons: detection.reviewReasons,
      originalMessage: entry.message,
      rawLine: entry.rawLine,
    },
    issues,
  };
}

function toConversationLine(
  entry: RawWhatsAppEntry,
  sourceFile: string,
  sourceId: string,
  restaurantName: string,
): ConversationLine {
  const timestampMs = parseRomanianTimestamp(entry.date, entry.time);

  return {
    id: conversationLineId(sourceFile, entry.lineNumber, entry.rawLine),
    sourceId,
    sourceFile,
    restaurantName,
    lineNumber: entry.lineNumber,
    timestampIso: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : '',
    timestampMs,
    senderRaw: entry.sender ?? '',
    message: entry.message,
    rawLine: entry.rawLine,
    isSystemLine: !entry.sender,
  };
}

function isLikelyRestaurantOrderNotice(
  line: ConversationLine,
  courierIdentities: Set<string>,
): boolean {
  if (!line.senderRaw || !Number.isFinite(line.timestampMs)) {
    return false;
  }
  if (courierIdentities.has(normalizeCourierIdentity(line.senderRaw))) {
    return false;
  }

  const message = line.message.trim();
  if (!message) {
    return false;
  }
  const hasOrderDetail =
    RESTAURANT_ORDER_ADDRESS_REGEX.test(message) ||
    RESTAURANT_ORDER_PHONE_REGEX.test(message) ||
    message.split('\n').filter(Boolean).length >= 2;
  return hasOrderDetail && message.length >= 24;
}

function requiresRestaurantNoticeForDayTariff(
  message: ParsedDeliveryMessage,
  schedule: RestaurantSchedule,
): boolean {
  return (usesNightTariff(schedule) && message.period === 'night') || !isWithinRestaurantSchedule(message.timestampMs, schedule);
}

function restaurantScheduleCutoffBefore(timestampMs: number, schedule: RestaurantSchedule): number {
  const closingMinutes = parseScheduleMinutes(schedule.closingTime);
  if (closingMinutes === null) {
    return timestampMs;
  }

  // Night pricing switches at 23:00 only when the restaurant explicitly uses a
  // night tariff. Day-only restaurants use their saved closing time instead.
  const cutoffMinutes = usesNightTariff(schedule) ? 23 * 60 : closingMinutes;
  const cutoff = new Date(timestampMs);
  cutoff.setHours(Math.floor(cutoffMinutes / 60), cutoffMinutes % 60, 0, 0);
  // For a pickup after midnight, this calendar day's 23:00 is still ahead; the
  // relevant tariff cutoff is yesterday at 23:00.
  if (timestampMs < cutoff.getTime()) {
    cutoff.setDate(cutoff.getDate() - 1);
  }
  return cutoff.getTime();
}

function parseRomanianTimestamp(date: string, time: string): number {
  const [day, month, year] = date.split('.').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  if (
    !isValidDatePart(year, month, day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return Number.NaN;
  }

  const timestamp = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    timestamp.getFullYear() !== year ||
    timestamp.getMonth() !== month - 1 ||
    timestamp.getDate() !== day
  ) {
    return Number.NaN;
  }

  return timestamp.getTime();
}

function isValidDatePart(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= 2000 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

function detectStatus(message: string): StatusDetection | null {
  const directMatch = DIRECT_STATUS_REGEX.exec(message);
  if (directMatch && isConciseOperationalAction(message)) {
    const mapped = mapStatusWord(directMatch[1]);
    return {
      status: mapped.status,
      rawStatus: directMatch[1],
      wasCorrected: mapped.wasCorrected,
      source: 'status',
      autoCountable: true,
    };
  }

  if (isDirectReturnAction(message) && isConciseOperationalAction(message)) {
    return {
      status: 'ridicat',
      rawStatus: 'retur',
      wasCorrected: false,
      source: 'return',
      autoCountable: true,
    };
  }

  if (isDirectCompletionAction(message) && isConciseOperationalAction(message)) {
    return {
      status: 'ridicat',
      rawStatus: 'completare',
      wasCorrected: false,
      source: 'completion',
      autoCountable: true,
    };
  }

  const leadingWord = leadingOperationalWord(message);
  if (leadingWord && isConciseOperationalAction(message)) {
    const word = normalizeWord(leadingWord);
    const ridicatDistance = levenshteinDistance(word, 'ridicat');
    const livratDistance = levenshteinDistance(word, 'livrat');

    if (isPlausibleStatusTypo(word, 'ridicat', ridicatDistance)) {
      return { status: 'ridicat', rawStatus: leadingWord, wasCorrected: true, source: 'status', autoCountable: true };
    }

    if (isPlausibleStatusTypo(word, 'livrat', livratDistance)) {
      return { status: 'livrat', rawStatus: leadingWord, wasCorrected: true, source: 'status', autoCountable: true };
    }
  }

  const narrativeMatch = STATUS_REGEX.exec(message);
  if (narrativeMatch) {
    const mapped = mapStatusWord(narrativeMatch[1]);
    return {
      status: mapped.status,
      rawStatus: narrativeMatch[1],
      wasCorrected: false,
      source: 'status',
      autoCountable: false,
      reviewReason: 'Statusul apare intr-un mesaj narativ sau prea lung; nu este numarat automat.',
    };
  }

  return null;
}

function isConciseOperationalAction(message: string): boolean {
  const normalized = message.trim();
  return normalized.length > 0 && normalized.length <= MAX_AUTOMATIC_ACTION_CHARACTERS && normalized.split('\n').length <= 2 && !normalized.includes('?');
}

function leadingOperationalWord(message: string): string | null {
  const normalized = normalizeWord(message).trim();
  const match = /^(?:[>*•-]\s*)?(?:am\s+)?([\p{L}]{4,10})(?=\s|:|x\s*\d|\d|$)/u.exec(normalized);
  return match?.[1] ?? null;
}

function mapStatusWord(rawWord: string): {
  status: ParsedDeliveryMessage['status'];
  wasCorrected: boolean;
} {
  const word = normalizeWord(rawWord);
  if (word === 'livrat') {
    return { status: 'livrat', wasCorrected: false };
  }
  if (word === 'ridicat') {
    return { status: 'ridicat', wasCorrected: false };
  }
  if (word === 'preluat' || word === 'ridica' || word === 'riscat' || word === 'luat') {
    return { status: 'ridicat', wasCorrected: true };
  }
  if (word === 'livrati') {
    return { status: 'livrat', wasCorrected: true };
  }

  return { status: 'livrat', wasCorrected: true };
}

function detectAvailability(message: string): {
  status: ParsedAvailabilityMessage['status'];
  usableForWorkHours: boolean;
  needsReview: boolean;
  reviewReasons: string[];
} | null {
  const normalized = normalizeWord(message);
  const correctedAvailability = detectAvailabilityTypo(normalized);
  if (!AVAILABILITY_REGEX.test(normalized) && !correctedAvailability) {
    return null;
  }
  AVAILABILITY_REGEX.lastIndex = 0;

  const reviewReasons: string[] = [];
  const availabilityText = correctedAvailability
    ? `${normalized} ${correctedAvailability}`
    : normalized;
  if (correctedAvailability) {
    reviewReasons.push(`Corectat automat ca ${correctedAvailability}; verifica mesajul original.`);
  }
  const negatedAvailability = /\bnu\b[^.?!\n]{0,30}\b(?:disponibil|online)\b/.test(availabilityText);
  const scheduledAvailability =
    /\b(?:voi\s+fi|o\s+sa\s+fiu|o\s+sa\s+fi|o\s+să\s+fiu|o\s+să\s+fi|dupa\s+ora|dupa\s+\d|de\s+la|pana\s+la|până\s+la|in\s+\d{1,2}(?:[-\s]\d{1,2})?\s*(?:min|minute|ore|h))\b/.test(
      normalized,
    );
  const hasUnavailable = /\b(indisponibil|indisp|offline)\b/.test(availabilityText) || negatedAvailability;
  const hasAvailable = /\b(disponibil|disp|online)\b/.test(availabilityText) && !hasUnavailable;

  if (hasUnavailable && /\b(?:disponibil|online)\b/.test(normalized) && !negatedAvailability) {
    reviewReasons.push('Mesajul contine stari opuse de pontaj; verifica manual intentia.');
  }

  if (negatedAvailability) {
    reviewReasons.push('Mesajul foloseste negatie cu disponibil; tratat ca indisponibil.');
  }

  if (scheduledAvailability) {
    reviewReasons.push(
      'Mesajul pare programare viitoare sau interval textual; nu este folosit automat la calculul orelor.',
    );
  }

  if (hasUnavailable) {
    return {
      status: 'indisponibil',
      usableForWorkHours: !scheduledAvailability,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    };
  }

  if (hasAvailable) {
    return {
      status: 'disponibil',
      usableForWorkHours: !scheduledAvailability,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    };
  }

  return null;
}

function detectAvailabilityTypo(normalizedMessage: string): (typeof AVAILABILITY_WORDS)[number] | null {
  for (const match of normalizedMessage.matchAll(WORD_REGEX)) {
    const word = normalizeWord(match[0]);
    for (const expected of AVAILABILITY_WORDS) {
      if (word === expected) {
        continue;
      }
      const maxDistance = expected.length >= 10 ? 2 : 1;
      if (
        word[0] === expected[0] &&
        Math.abs(word.length - expected.length) <= 1 &&
        levenshteinDistance(word, expected) <= maxDistance
      ) {
        return expected;
      }
    }
  }
  return null;
}

function isPlausibleStatusTypo(word: string, expected: string, distance: number): boolean {
  if (word === expected || word[0] !== expected[0] || Math.abs(word.length - expected.length) > 1) {
    return false;
  }

  return distance <= 1 || (expected.length >= 6 && distance <= 2);
}

function normalizeWord(word: string): string {
  return word
    .toLocaleLowerCase('ro-RO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș/g, 's')
    .replace(/ţ/g, 't')
    .replace(/ț/g, 't');
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function isConversationalStatusReference(
  message: string,
  rawStatus: string,
  hasQuantity: boolean,
  hasMoneyAmount: boolean,
): boolean {
  const normalized = normalizeWord(message);
  const status = normalizeWord(rawStatus);

  if (normalized.includes('?')) {
    return true;
  }

  if (
    new RegExp(`\\bnu\\s+(?:am\\s+|ai\\s+|a\\s+|ati\\s+|au\\s+)?${status}\\b`).test(
      normalized,
    ) ||
    new RegExp(`\\b(?:daca|cine|cand|unde|cum)\\b[^\\n.?!]*\\b${status}\\b`).test(
      normalized,
    ) ||
    new RegExp(`\\b(?:ai|a|ati|au)\\s+${status}\\b`).test(normalized)
  ) {
    return true;
  }

  if (hasQuantity || hasMoneyAmount) {
    return false;
  }

  if (!isStandaloneStatusMessage(message, rawStatus)) {
    return true;
  }

  return false;
}

function isStandaloneStatusMessage(message: string, rawStatus: string): boolean {
  const normalizedStatus = normalizeWord(rawStatus);
  const normalizedMessage = normalizeWord(message)
    .replace(EDITED_MESSAGE_REGEX, '')
    .replace(new RegExp(`\\b${escapeRegExp(normalizedStatus)}\\b`, 'i'), '')
    .replace(/\bx\b/i, '')
    .replace(/[\s:.,;!()[\]{}"'<>-]+/g, '');

  return normalizedMessage.length === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseQuantityMatch(match: RegExpExecArray): number {
  const rawQuantity = match[1] ?? match[2];
  const quantity = Number.parseInt(rawQuantity, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function detectImplicitQuantity(
  message: string,
  rawStatus: string,
): { quantity: number; reviewReason: string } | null {
  const normalizedMessage = normalizeWord(message)
    .replace(EDITED_MESSAGE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedStatus = normalizeWord(rawStatus);
  const statusPattern = escapeRegExp(normalizedStatus);
  const simpleNumberAfterStatus = new RegExp(`\\b${statusPattern}\\b[\\s:.,;-]*(\\d{1,2})\\b`);
  const simpleNumberBeforeStatus = new RegExp(`\\b(\\d{1,2})\\b[\\s:.,;-]*\\b${statusPattern}\\b`);
  const simpleNumberMatch =
    simpleNumberAfterStatus.exec(normalizedMessage) ?? simpleNumberBeforeStatus.exec(normalizedMessage);
  if (simpleNumberMatch) {
    const quantity = Number.parseInt(simpleNumberMatch[1], 10);
    if (Number.isInteger(quantity) && quantity > 0 && quantity <= 20) {
      return {
        quantity,
        reviewReason: `Cantitate interpretata din numar simplu langa status: x${quantity}.`,
      };
    }
  }

  const wordQuantity = detectWordQuantity(normalizedMessage);
  if (wordQuantity && !isAmbiguousWordQuantityContext(normalizedMessage, wordQuantity.pattern)) {
    const firstPersonAction = new RegExp(`\\bam\\s+${statusPattern}\\b`).test(normalizedMessage);
    const statusThenQuantity = new RegExp(
      `\\b${statusPattern}\\b(?:\\s+\\p{L}{2,12}){0,4}\\s+${wordQuantity.pattern}\\b`,
      'u',
    ).test(normalizedMessage);

    if (firstPersonAction || statusThenQuantity) {
      return {
        quantity: wordQuantity.quantity,
        reviewReason: `Cantitate interpretata din text ("${wordQuantity.label}"): x${wordQuantity.quantity}.`,
      };
    }
  }

  const addressQuantity = detectAddressListQuantity(normalizedMessage, normalizedStatus);
  if (addressQuantity) {
    return {
      quantity: addressQuantity,
      reviewReason: `Cantitate interpretata din adrese multiple langa status: x${addressQuantity}.`,
    };
  }

  return null;
}

function detectWordQuantity(message: string): {
  quantity: number;
  label: string;
  pattern: string;
} | null {
  const quantities = [
    { quantity: 1, label: 'una/un/o', pattern: '(?:una|unu|unul|un|o)' },
    { quantity: 2, label: 'doua/doi', pattern: '(?:doua|doi)' },
    { quantity: 3, label: 'trei', pattern: 'trei' },
  ];

  return quantities.find((item) => new RegExp(`\\b${item.pattern}\\b`, 'u').test(message)) ?? null;
}

function isAmbiguousWordQuantityContext(message: string, quantityPattern: string): boolean {
  const timeOrPlaceBeforeQuantity = new RegExp(
    `\\b(?:la|dupa|peste|in|spre)\\s+(?:ora\\s+)?${quantityPattern}\\b`,
    'u',
  );
  const hourBeforeQuantity = new RegExp(`\\b(?:ora|orele)\\s+${quantityPattern}\\b`, 'u');
  const stepsAfterQuantity = new RegExp(`\\b${quantityPattern}\\s+(?:pasi|pas)\\b`, 'u');

  return (
    timeOrPlaceBeforeQuantity.test(message) ||
    hourBeforeQuantity.test(message) ||
    stepsAfterQuantity.test(message)
  );
}

function detectAddressListQuantity(normalizedMessage: string, normalizedStatus: string): number | null {
  if (normalizedStatus !== 'ridicat' && normalizedStatus !== 'preluat' && normalizedStatus !== 'luat') {
    return null;
  }

  const match = new RegExp(`^(?:am\\s+)?${escapeRegExp(normalizedStatus)}\\s+(.+)$`, 'u').exec(
    normalizedMessage,
  );
  const rest = match?.[1]?.trim();
  if (!rest) {
    return null;
  }

  if (
    /\b(?:zona|lei|ron|retur|completare|anulat|dai|dat|gata|dupa|dupa|minute|min|semafor|bon|poza)\b/.test(
      rest,
    )
  ) {
    return null;
  }

  if (!/(?:\bsi\b|,|\/|\+)/.test(rest)) {
    return null;
  }

  const parts = rest
    .split(/\bsi\b|,|\/|\+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\d]/u.test(part));
  if (parts.length >= 2 && parts.length <= 6) {
    return parts.length;
  }

  return null;
}

function shouldReviewMissingQuantity(
  status: ParsedDeliveryMessage['status'],
  hasMoneyAmount: boolean,
  hasZoneMention: boolean,
  hasCompletion: boolean,
  hasDirectReturn: boolean,
): boolean {
  if (status === 'ridicat' && (hasMoneyAmount || hasZoneMention || hasCompletion || hasDirectReturn)) {
    return false;
  }

  return true;
}

function hasGluedStatusQuantity(message: string, rawStatus: string): boolean {
  const normalized = normalizeWord(message);
  const status = escapeRegExp(normalizeWord(rawStatus));
  return new RegExp(`\\b${status}x\\s*\\d+\\b`).test(normalized);
}

function extractNote(message: string): string {
  return message
    .replace(STATUS_REGEX, '')
    .replace(QUANTITY_REGEX, '')
    .replace(ZONE_REGEX, '')
    .replace(EDITED_MESSAGE_REGEX, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:.,;-]+|[\s:.,;-]+$/g, '')
    .trim();
}

function normalizeParsedDeliveryMessage(message: ParsedDeliveryMessage): ParsedDeliveryMessage {
  const timestampMs = Number.isFinite(message.timestampMs)
    ? message.timestampMs
    : Date.parse(message.timestampIso);
  const quantity = positiveNumber(message.quantity, 1);
  const originalMessage = message.originalMessage ?? message.note ?? '';
  const status: ParsedDeliveryMessage['status'] = message.status === 'livrat' ? 'livrat' : 'ridicat';
  const paidReturnLocationQuantity = detectPaidReturnLocationQuantity(originalMessage, status);
  const period = message.period === 'night' || message.period === 'day'
    ? message.period
    : isNightTimestamp(timestampMs)
      ? 'night'
      : 'day';
  const paidFieldsAreValid =
    isZoneCounts(message.paidZoneCounts) &&
    Number.isFinite(message.paidQuantity) &&
    Number.isFinite(message.paidOutsideZoneDeliveries) &&
    Number.isFinite(message.paidOutsideKilometers) &&
    Number.isFinite(message.paidOutsideAmountLei);

  if (paidFieldsAreValid) {
    return {
      ...message,
      status,
      period,
      timestampMs,
      timestampIso: message.timestampIso || new Date(timestampMs).toISOString(),
      reportDayKey: message.reportDayKey || reportDayKey(timestampMs),
      quantity,
      zoneCounts: normalizeZoneCounts(message.zoneCounts),
      outsideKilometers: positiveNumber(message.outsideKilometers, 0),
      outsideAmountLei: positiveNumber(message.outsideAmountLei, 0),
      paidQuantity: positiveNumber(message.paidQuantity, 0),
      paidZoneCounts: normalizeZoneCounts(message.paidZoneCounts),
      paidOutsideZoneDeliveries: positiveNumber(message.paidOutsideZoneDeliveries, 0),
      paidOutsideKilometers: positiveNumber(message.paidOutsideKilometers, 0),
      paidOutsideAmountLei: positiveNumber(message.paidOutsideAmountLei, 0),
      paidSource: normalizePaidSource(message.paidSource),
      paidReturnLocationQuantity,
      autoCountable: message.autoCountable !== false,
      reviewReasons: Array.isArray(message.reviewReasons) ? message.reviewReasons : [],
    };
  }

  const paidClassification = classifyPaidDelivery(
    originalMessage,
    status,
    quantity,
    isDirectReturnAction(originalMessage),
    containsCompletionMention(originalMessage),
  );
  const reviewReasons = Array.from(
    new Set([
      ...(Array.isArray(message.reviewReasons) ? message.reviewReasons : []),
      'Import vechi normalizat automat pentru regulile noi de plata.',
      ...paidClassification.reviewReasons,
    ]),
  );

  return {
    ...message,
    status,
    period,
    timestampMs,
    timestampIso: message.timestampIso || new Date(timestampMs).toISOString(),
    reportDayKey: message.reportDayKey || reportDayKey(timestampMs),
    quantity,
    zoneCounts: normalizeZoneCounts(message.zoneCounts),
    outsideKilometers: positiveNumber(message.outsideKilometers, 0),
    outsideAmountLei: positiveNumber(message.outsideAmountLei, 0),
    paidQuantity: paidClassification.paidQuantity,
    paidZoneCounts: paidClassification.paidZoneCounts,
    paidOutsideZoneDeliveries: paidClassification.paidOutsideZoneDeliveries,
    paidOutsideKilometers: paidClassification.paidOutsideKilometers,
    paidOutsideAmountLei: paidClassification.paidOutsideAmountLei,
    paidSource: paidClassification.paidSource,
    paidReturnLocationQuantity,
    autoCountable: message.autoCountable !== false,
    needsReview: true,
    reviewReasons,
  };
}

function normalizePaidSource(value: unknown): PaidSource {
  return value === 'pickup' || value === 'return' || value === 'completion' || value === 'none'
    ? value
    : 'none';
}

function normalizeZoneCounts(value: unknown): ZoneCounts {
  if (!isZoneCounts(value)) {
    return createEmptyZoneCounts();
  }

  return {
    zone1: positiveNumber(value.zone1, 0),
    zone2: positiveNumber(value.zone2, 0),
    zone3: positiveNumber(value.zone3, 0),
  };
}

function isZoneCounts(value: unknown): value is ZoneCounts {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ZoneCounts>;
  return (
    typeof candidate.zone1 === 'number' &&
    typeof candidate.zone2 === 'number' &&
    typeof candidate.zone3 === 'number'
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function classifyPaidDelivery(
  message: string,
  status: ParsedDeliveryMessage['status'],
  quantity: number,
  isReturn: boolean,
  hasCompletion: boolean,
): PaidClassification {
  const paidZoneCounts = createEmptyZoneCounts();
  const reviewReasons: string[] = [];
  if (status !== 'ridicat') {
    return {
      paidQuantity: 0,
      paidZoneCounts,
      paidOutsideZoneDeliveries: 0,
      paidOutsideKilometers: 0,
      paidOutsideAmountLei: 0,
      paidSource: 'none',
      reviewReasons,
    };
  }

  const paidQuantity = Math.max(0, quantity - detectExplicitCanceledQuantity(message, quantity));
  const outsideAmountLei = detectOutsideAmountLei(message);
  const outsideKilometers = detectOutsideKilometers(message);
  const source: PaidSource = isReturn ? 'return' : hasCompletion ? 'completion' : 'pickup';
  const hasOutsideValue = outsideAmountLei > 0 || outsideKilometers > 0;
  if (paidQuantity === 0) {
    return createEmptyPaidClassification();
  }

  const zoneClassification = classifyPaidZones(message, paidQuantity, !hasOutsideValue);
  reviewReasons.push(...zoneClassification.reviewReasons);

  if (outsideAmountLei > 0) {
    const classifiedQuantity =
      sumZoneCounts(zoneClassification.zoneCounts) + zoneClassification.outsideZoneDeliveries;
    const outsideRemainder = Math.max(0, paidQuantity - classifiedQuantity);
    if (classifiedQuantity > 0 && outsideRemainder > 0) {
      reviewReasons.push('Mesajul are si zona, si suma in lei; doar comenzile fara zona clara sunt tratate ca exterior.');
    } else if (classifiedQuantity >= paidQuantity) {
      reviewReasons.push('Mesajul are suma in lei langa zone explicite; verifica daca suma este taxa separata.');
    }
    return {
      paidQuantity,
      paidZoneCounts: zoneClassification.zoneCounts,
      paidOutsideZoneDeliveries: zoneClassification.outsideZoneDeliveries + outsideRemainder,
      paidOutsideKilometers: outsideKilometers,
      paidOutsideAmountLei: outsideAmountLei,
      paidSource: source,
      reviewReasons,
    };
  }

  if (outsideKilometers > 0) {
    const classifiedQuantity =
      sumZoneCounts(zoneClassification.zoneCounts) + zoneClassification.outsideZoneDeliveries;
    const outsideRemainder = Math.max(0, paidQuantity - classifiedQuantity);
    return {
      paidQuantity,
      paidZoneCounts: zoneClassification.zoneCounts,
      paidOutsideZoneDeliveries: zoneClassification.outsideZoneDeliveries + outsideRemainder,
      paidOutsideKilometers: outsideKilometers,
      paidOutsideAmountLei: 0,
      paidSource: source,
      reviewReasons,
    };
  }

  return {
    paidQuantity,
    paidZoneCounts: zoneClassification.zoneCounts,
    paidOutsideZoneDeliveries: zoneClassification.outsideZoneDeliveries,
    paidOutsideKilometers: outsideKilometers,
    paidOutsideAmountLei: 0,
    paidSource: source,
    reviewReasons,
  };
}

function createEmptyPaidClassification(): PaidClassification {
  return {
    paidQuantity: 0,
    paidZoneCounts: createEmptyZoneCounts(),
    paidOutsideZoneDeliveries: 0,
    paidOutsideKilometers: 0,
    paidOutsideAmountLei: 0,
    paidSource: 'none',
    reviewReasons: [],
  };
}

function classifyPaidZones(
  message: string,
  quantity: number,
  fillRemainderWithZone1 = true,
): ZoneClassification {
  const zoneCounts = createEmptyZoneCounts();
  const reviewReasons: string[] = [];
  const zonesMentioned = Array.from(message.matchAll(ZONE_REGEX), (match) => Number(match[1]));
  ZONE_REGEX.lastIndex = 0;
  const quantityZoneMatches = Array.from(message.matchAll(EXPLICIT_ZONE_QUANTITY_REGEX));
  EXPLICIT_ZONE_QUANTITY_REGEX.lastIndex = 0;
  let outsideZoneDeliveries = 0;

  if (quantityZoneMatches.length > 0) {
    for (const match of quantityZoneMatches) {
      const parsedZoneQuantity = parseExplicitZoneQuantityMatch(match);
      if (!parsedZoneQuantity) {
        continue;
      }
      const { zoneQuantity, zoneNumber } = parsedZoneQuantity;
      if (zoneNumber > 3) {
        outsideZoneDeliveries += zoneQuantity;
      } else {
        incrementZone(zoneCounts, zoneNumber, zoneQuantity);
      }
    }

    const classifiedQuantity = sumZoneCounts(zoneCounts) + outsideZoneDeliveries;
    if (classifiedQuantity > quantity) {
      reviewReasons.push('Cantitatile pe zone depasesc cantitatea ridicata din mesaj.');
      return { zoneCounts, outsideZoneDeliveries, reviewReasons };
    }

    if (fillRemainderWithZone1) {
      zoneCounts.zone1 += quantity - classifiedQuantity;
    }
    return { zoneCounts, outsideZoneDeliveries, reviewReasons };
  }

  const uniqueZones = Array.from(new Set(zonesMentioned));
  if (uniqueZones.length === 0) {
    if (fillRemainderWithZone1) {
      zoneCounts.zone1 += quantity;
    }
    return { zoneCounts, outsideZoneDeliveries, reviewReasons };
  }

  if (uniqueZones.length === 1) {
    if (uniqueZones[0] > 3) {
      outsideZoneDeliveries += quantity;
    } else {
      incrementZone(zoneCounts, uniqueZones[0], quantity);
    }
    return { zoneCounts, outsideZoneDeliveries, reviewReasons };
  }

  reviewReasons.push('Mesajul contine mai multe zone fara cantitati clare.');
  return { zoneCounts, outsideZoneDeliveries, reviewReasons };
}

function detectDeliveryZones(
  message: string,
  status: ParsedDeliveryMessage['status'],
  quantity: number,
): { zoneCounts: ZoneCounts; reviewReasons: string[] } {
  const zoneCounts = createEmptyZoneCounts();
  const reviewReasons: string[] = [];

  if (status !== 'livrat') {
    return { zoneCounts, reviewReasons };
  }

  const zonesMentioned = Array.from(message.matchAll(ZONE_REGEX), (match) => Number(match[1]));
  ZONE_REGEX.lastIndex = 0;
  if (zonesMentioned.length === 0) {
    return { zoneCounts, reviewReasons };
  }

  const quantityZoneMatches = Array.from(message.matchAll(EXPLICIT_ZONE_QUANTITY_REGEX));
  EXPLICIT_ZONE_QUANTITY_REGEX.lastIndex = 0;
  if (quantityZoneMatches.length > 0) {
    for (const match of quantityZoneMatches) {
      const parsedZoneQuantity = parseExplicitZoneQuantityMatch(match);
      if (!parsedZoneQuantity) {
        continue;
      }
      const { zoneQuantity, zoneNumber } = parsedZoneQuantity;
      incrementZone(zoneCounts, zoneNumber, zoneQuantity);
      if (zoneNumber > 3) {
        reviewReasons.push('Mesajul mentioneaza zona peste 3; este tratat ca exterior in calculul de plata.');
      }
    }

    const zonedQuantity = sumZoneCounts(zoneCounts);
    if (zonedQuantity > quantity) {
      reviewReasons.push('Cantitatile pe zone depasesc cantitatea livrata din mesaj.');
    }
    return { zoneCounts, reviewReasons };
  }

  const uniqueZones = Array.from(new Set(zonesMentioned));
  if (uniqueZones.length === 1) {
    incrementZone(zoneCounts, uniqueZones[0], quantity);
    if (uniqueZones[0] > 3) {
      reviewReasons.push('Mesajul mentioneaza zona peste 3; verifica daca trebuie tratat pe kilometri.');
    }
    return { zoneCounts, reviewReasons };
  }

  reviewReasons.push('Mesajul contine mai multe zone fara cantitati clare.');
  return { zoneCounts, reviewReasons };
}

function parseExplicitZoneQuantityMatch(
  match: RegExpMatchArray,
): { zoneQuantity: number; zoneNumber: number } | null {
  const zoneQuantity = Number.parseInt(match[1] ?? match[3] ?? match[6] ?? match[7], 10);
  const zoneNumber = Number(match[2] ?? match[4] ?? match[5] ?? match[8]);
  if (!Number.isInteger(zoneQuantity) || zoneQuantity <= 0 || !Number.isInteger(zoneNumber) || zoneNumber < 1) {
    return null;
  }
  return { zoneQuantity, zoneNumber };
}

function buildPaidUnits(message: ParsedDeliveryMessage): PaidUnitClassification[] {
  if (message.status !== 'ridicat' || message.paidQuantity <= 0) {
    return [];
  }

  const units: PaidUnitClassification[] = [];
  const explicitZones = classifyPaidZones(message.originalMessage, message.paidQuantity, false);
  for (let index = 0; index < explicitZones.zoneCounts.zone1; index += 1) {
    units.push({ kind: 'zone', zone: 1, explicit: true });
  }
  for (let index = 0; index < explicitZones.zoneCounts.zone2; index += 1) {
    units.push({ kind: 'zone', zone: 2, explicit: true });
  }
  for (let index = 0; index < explicitZones.zoneCounts.zone3; index += 1) {
    units.push({ kind: 'zone', zone: 3, explicit: true });
  }

  const explicitOutsideCount = Math.max(0, explicitZones.outsideZoneDeliveries);
  for (let index = 0; index < explicitOutsideCount; index += 1) {
    units.push({
      kind: 'outside',
      explicit: true,
      kilometers: index === 0 ? message.paidOutsideKilometers : 0,
      amountLei: index === 0 ? message.paidOutsideAmountLei : 0,
    });
  }

  const currentExplicitCount = units.length;
  const outsideRemainder = Math.max(0, message.paidOutsideZoneDeliveries - explicitOutsideCount);
  for (let index = 0; index < outsideRemainder; index += 1) {
    units.push({
      kind: 'outside',
      explicit: true,
      kilometers: currentExplicitCount === 0 && index === 0 ? message.paidOutsideKilometers : 0,
      amountLei: currentExplicitCount === 0 && index === 0 ? message.paidOutsideAmountLei : 0,
    });
  }

  while (units.length < message.paidQuantity) {
    units.push({ kind: 'zone', zone: 1, explicit: false });
  }

  return units.slice(0, message.paidQuantity);
}

function buildDeliveryClassificationUnits(message: ParsedDeliveryMessage): PaidUnitClassification[] {
  if (message.status !== 'livrat' || message.quantity <= 0) {
    return [];
  }

  const units: PaidUnitClassification[] = [];
  const explicitZones = classifyPaidZones(message.originalMessage, message.quantity, false);
  for (let index = 0; index < explicitZones.zoneCounts.zone1; index += 1) {
    units.push({ kind: 'zone', zone: 1, explicit: true });
  }
  for (let index = 0; index < explicitZones.zoneCounts.zone2; index += 1) {
    units.push({ kind: 'zone', zone: 2, explicit: true });
  }
  for (let index = 0; index < explicitZones.zoneCounts.zone3; index += 1) {
    units.push({ kind: 'zone', zone: 3, explicit: true });
  }

  const outsideMentionCount = explicitZones.outsideZoneDeliveries;
  const hasOutsideValue = message.outsideAmountLei > 0 || message.outsideKilometers > 0;
  const outsideCount = hasOutsideValue
    ? Math.max(1, message.quantity - units.length)
    : outsideMentionCount;
  for (let index = 0; index < outsideCount; index += 1) {
    units.push({
      kind: 'outside',
      explicit: true,
      kilometers: index === 0 ? message.outsideKilometers : 0,
      amountLei: index === 0 ? message.outsideAmountLei : 0,
    });
  }

  return units.slice(0, message.quantity);
}

function buildPaidReturnLocationUnits(message: ParsedDeliveryMessage): PaidUnitClassification[] {
  if (message.status !== 'livrat' || message.paidReturnLocationQuantity !== 1) {
    return [];
  }

  // A confirmed return to the restaurant is paid as one normal Z1 route.
  return [{ kind: 'zone', zone: 1, explicit: true }];
}

function applyPaidReturnLocationUnitToSummaries(
  summary: CourierSummary,
  restaurantSummary: RestaurantSummary,
  dailySummary: DailyCourierSummary,
  period: 'day' | 'night',
  unit: PaidUnitClassification,
): void {
  applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, period, unit, 1);
  if (period === 'night') {
    summary.nightDelivered += 1;
    restaurantSummary.nightDelivered += 1;
    dailySummary.nightDelivered += 1;
    return;
  }

  summary.delivered += 1;
  restaurantSummary.delivered += 1;
  dailySummary.delivered += 1;
}

function applyPaidUnitToSummaries(
  summary: CourierSummary,
  restaurantSummary: RestaurantSummary,
  dailySummary: DailyCourierSummary,
  period: 'day' | 'night',
  unit: PaidUnitClassification,
  direction: 1 | -1,
): void {
  if (period === 'night') {
    summary.nightPickedUp += direction;
    restaurantSummary.nightPickedUp += direction;
    dailySummary.nightPickedUp += direction;
    applyUnitClassification(
      summary.nightZoneCounts,
      (value) => {
        summary.nightOutsideZoneDeliveries += value;
        restaurantSummary.nightOutsideZoneDeliveries += value;
        dailySummary.nightOutsideZoneDeliveries += value;
      },
      (kilometers, amountLei) => {
        summary.nightOutsideKilometers += kilometers;
        summary.nightOutsideAmountLei += amountLei;
        restaurantSummary.nightOutsideKilometers += kilometers;
        restaurantSummary.nightOutsideAmountLei += amountLei;
        dailySummary.nightOutsideKilometers += kilometers;
        dailySummary.nightOutsideAmountLei += amountLei;
      },
      restaurantSummary.nightZoneCounts,
      dailySummary.nightZoneCounts,
      unit,
      direction,
    );
    return;
  }

  summary.pickedUp += direction;
  restaurantSummary.pickedUp += direction;
  dailySummary.pickedUp += direction;
  applyUnitClassification(
    summary.zoneCounts,
    (value) => {
      summary.outsideZoneDeliveries += value;
      restaurantSummary.outsideZoneDeliveries += value;
      dailySummary.outsideZoneDeliveries += value;
    },
    (kilometers, amountLei) => {
      summary.outsideKilometers += kilometers;
      summary.outsideAmountLei += amountLei;
      restaurantSummary.outsideKilometers += kilometers;
      restaurantSummary.outsideAmountLei += amountLei;
      dailySummary.outsideKilometers += kilometers;
      dailySummary.outsideAmountLei += amountLei;
    },
    restaurantSummary.zoneCounts,
    dailySummary.zoneCounts,
    unit,
    direction,
  );
}

function applyUnitClassification(
  summaryZones: ZoneCounts,
  addOutsideCount: (value: number) => void,
  addOutsideValues: (kilometers: number, amountLei: number) => void,
  restaurantZones: ZoneCounts,
  dailyZones: ZoneCounts,
  unit: PaidUnitClassification,
  direction: 1 | -1,
): void {
  if (unit.kind === 'zone') {
    incrementZone(summaryZones, unit.zone, direction);
    incrementZone(restaurantZones, unit.zone, direction);
    incrementZone(dailyZones, unit.zone, direction);
    return;
  }

  addOutsideCount(direction);
  addOutsideValues(direction * unit.kilometers, direction * unit.amountLei);
}

function reconcileDeliveryClassification(
  pickup: DeliveryPickup,
  deliveryUnit: PaidUnitClassification,
  summary: CourierSummary,
  restaurantSummary: RestaurantSummary,
  dailySummary: DailyCourierSummary,
  deliveryMessage: ParsedDeliveryMessage,
  courierName: string,
  reviewRows: ReviewRow[],
): void {
  if (!pickup.classification.explicit && !sameUnitClassification(pickup.classification, deliveryUnit)) {
    applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, pickup.period, pickup.classification, -1);
    applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, pickup.period, deliveryUnit, 1);
    pickup.classification = deliveryUnit;
    reviewRows.push({
      kind: 'message',
      id: `delivery-classification-${pickup.messageId}-${deliveryMessage.id}`,
      messageId: deliveryMessage.id,
      severity: 'warning',
      sourceId: deliveryMessage.sourceId,
      sourceFile: deliveryMessage.sourceFile,
      lineNumber: deliveryMessage.lineNumber,
      restaurantName: deliveryMessage.restaurantName,
      courierName,
      timestampIso: deliveryMessage.timestampIso,
      status: deliveryMessage.status,
      quantity: deliveryMessage.quantity,
      reason: 'Zona/exterior completata din mesajul livrat pentru o ridicare fara zona explicita.',
      originalMessage: deliveryMessage.originalMessage,
      rawLine: deliveryMessage.rawLine,
    });
    return;
  }

  if (pickup.classification.explicit && !sameUnitClassification(pickup.classification, deliveryUnit)) {
    applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, pickup.period, pickup.classification, -1);
    applyPaidUnitToSummaries(summary, restaurantSummary, dailySummary, pickup.period, deliveryUnit, 1);
    pickup.classification = deliveryUnit;
    reviewRows.push({
      kind: 'mismatch',
      id: `delivery-classification-conflict-${pickup.messageId}-${deliveryMessage.id}`,
      severity: 'warning',
      restaurantName: deliveryMessage.restaurantName,
      courierName,
      pickedUp: 1,
      delivered: 1,
      difference: 0,
      reason: 'Zona/exterior din livrat corecteaza ridicarea explicita; calculul foloseste livratul si pastreaza cazul la review.',
      sourceMessageIds: [pickup.messageId, deliveryMessage.id],
    });
  }
}

function sameUnitClassification(left: PaidUnitClassification, right: PaidUnitClassification): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'zone' && right.kind === 'zone') {
    return left.zone === right.zone;
  }
  if (left.kind === 'outside' && right.kind === 'outside') {
    return true;
  }
  return false;
}

function createEmptyZoneCounts(): ZoneCounts {
  return {
    zone1: 0,
    zone2: 0,
    zone3: 0,
  };
}

function incrementZone(zoneCounts: ZoneCounts, zoneNumber: number, quantity: number): void {
  if (!Number.isFinite(quantity) || quantity === 0) {
    return;
  }

  if (zoneNumber === 1) {
    zoneCounts.zone1 += quantity;
  } else if (zoneNumber === 2) {
    zoneCounts.zone2 += quantity;
  } else if (zoneNumber === 3) {
    zoneCounts.zone3 += quantity;
  }
}

function addZoneCounts(target: ZoneCounts, source: ZoneCounts | undefined): void {
  const safeSource = normalizeZoneCounts(source);
  target.zone1 += safeSource.zone1;
  target.zone2 += safeSource.zone2;
  target.zone3 += safeSource.zone3;
}

function sumZoneCounts(zoneCounts: ZoneCounts): number {
  return zoneCounts.zone1 + zoneCounts.zone2 + zoneCounts.zone3;
}

function isOutsideDeliveryMessage(message: ParsedDeliveryMessage): boolean {
  return (
    message.status === 'livrat' &&
    (message.outsideKilometers > 0 ||
      message.outsideAmountLei > 0 ||
      hasOutsideZoneMention(message.originalMessage))
  );
}

function detectOutsideKilometers(message: string): number {
  const matches = Array.from(message.matchAll(KILOMETER_REGEX));
  KILOMETER_REGEX.lastIndex = 0;

  return matches.reduce((total, match) => {
    const rawValue = match[1] ?? match[2];
    const parsed = Number.parseFloat(rawValue.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? total + parsed : total;
  }, 0);
}

function detectOutsideAmountLei(message: string): number {
  const matches = Array.from(message.matchAll(MONEY_REGEX));
  MONEY_REGEX.lastIndex = 0;

  return matches.reduce((total, match) => {
    const parsed = Number.parseFloat(match[1].replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? total + parsed : total;
  }, 0);
}

function containsMoneyAmount(message: string): boolean {
  const hasMatch = MONEY_REGEX.test(message);
  MONEY_REGEX.lastIndex = 0;
  return hasMatch;
}

function containsZoneMention(message: string): boolean {
  const hasMatch = ZONE_REGEX.test(message);
  ZONE_REGEX.lastIndex = 0;
  return hasMatch;
}

function containsCompletionMention(message: string): boolean {
  return COMPLETION_REGEX.test(normalizeWord(message));
}

function isDirectCompletionAction(message: string): boolean {
  const normalized = normalizeWord(message).trim();
  if (!COMPLETION_REGEX.test(normalized) || normalized.includes('?')) {
    return false;
  }

  return /^(?:\s*(?:x\s*\d+|\d+\s*x)?\s*)completare(?:\s+comanda)?\b/.test(normalized);
}

function isDirectReturnAction(message: string): boolean {
  const normalized = normalizeWord(message).trim();
  if (!RETURN_REGEX.test(normalized)) {
    return false;
  }
  if (normalized.includes('?')) {
    return false;
  }
  const allowedSuffix = '(?:\\s+(?:x\\s*\\d+|\\d+\\s*x|zona\\s*[1-3]|pos|\\d+(?:[.,]\\d+)?\\s*lei))*\\s*[.!]?$';
  return new RegExp(`^(?:(?:x\\s*\\d+|\\d+\\s*x)\\s*)?retur\\b${allowedSuffix}`).test(normalized) ||
    new RegExp(`^anulat[ăa]?\\s*\\(\\s*retur\\s*\\)${allowedSuffix}`).test(normalized);
}

function detectPaidReturnLocationQuantity(
  message: string,
  status: ParsedDeliveryMessage['status'],
): number {
  if (status !== 'livrat' || !isConciseOperationalAction(message)) {
    return 0;
  }

  const normalized = normalizeWord(message).trim();
  const isDirectDelivery = /^(?:[>*•-]\s*)?(?:am\s+)?livrat\b/.test(normalized);
  const hasReturnLocation = /\bretur\s+locatie\b/.test(normalized);
  const hasCanceledOrRefusedOrder = /\b(?:comanda\s+)?(?:anulata|refuzata)\b/.test(normalized);

  // Do not infer payment from a narrative mention. The operational delivery must
  // explicitly identify both the cancelled/refused order and the return location.
  return isDirectDelivery && hasReturnLocation && hasCanceledOrRefusedOrder ? 1 : 0;
}

function detectExplicitCanceledQuantity(message: string, maximumQuantity: number): number {
  const normalized = normalizeWord(message);
  if (!CANCELED_REGEX.test(normalized) && !REFUSED_REGEX.test(normalized)) {
    return 0;
  }
  CANCELED_REGEX.lastIndex = 0;
  REFUSED_REGEX.lastIndex = 0;

  const matches = normalized.matchAll(
    /(?:\b(\d+)\s*x\s*(?:comanda\s*)?(?:anulata|refuzata)\b|\bx\s*(\d+)\s*(?:comanda\s*)?(?:anulata|refuzata)\b)/g,
  );
  const canceledQuantity = Array.from(matches).reduce((total, match) => {
    const quantity = Number.parseInt(match[1] ?? match[2] ?? '0', 10);
    return Number.isFinite(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);

  return Math.min(Math.max(0, canceledQuantity), Math.max(0, maximumQuantity));
}

function hasOutsideZoneMention(message: string): boolean {
  const zones = Array.from(message.matchAll(ZONE_REGEX), (match) => Number(match[1]));
  ZONE_REGEX.lastIndex = 0;
  return zones.some((zone) => zone > 3);
}

function deliveryQueueKey(restaurantName: string, courierId: string, reportImportId?: string): string {
  return `${reportImportId ?? 'legacy-import'}:${restaurantName.toLocaleLowerCase('ro-RO')}:${courierId}`;
}

function takePickupForDelivery(
  queue: DeliveryPickup[],
  deliveryTimestampMs: number,
  deliveryMessageId: string,
  courierName: string,
  reviewRows: ReviewRow[],
): DeliveryPickupMatch | null {
  let stalePickup: DeliveryPickup | null = null;
  while (queue.length) {
    const pickup = queue.shift();
    if (!pickup) {
      continue;
    }
    if (pickup.timestampMs > deliveryTimestampMs) {
      queue.unshift(pickup);
      return null;
    }

    const minutes = (deliveryTimestampMs - pickup.timestampMs) / 60_000;
    if (minutes <= MAX_AUTOMATIC_DELIVERY_DURATION_MINUTES) {
      return { pickup, useForAverage: true };
    }

    reviewRows.push({
      kind: 'mismatch',
      id: `delivery-time-too-long-${pickup.messageId}-${deliveryMessageId}`,
      severity: 'warning',
      courierName,
      pickedUp: 1,
      delivered: 1,
      difference: 0,
      reason: `Pereche ridicat-livrat exclusa din media de livrare: ${Math.round(minutes)} minute depaseste limita automata de ${MAX_AUTOMATIC_DELIVERY_DURATION_MINUTES} minute.`,
      sourceMessageIds: [pickup.messageId, deliveryMessageId],
    });
    stalePickup = pickup;
  }

  return stalePickup ? { pickup: stalePickup, useForAverage: false } : null;
}

function addDeliveryDuration(
  target: {
    deliveryTimeSampleCount: number;
    averageDeliveryMinutes: number | null;
    medianDeliveryMinutes: number | null;
    deliveryDurationMinutesSamples: number[];
  },
  minutes: number,
): void {
  const durationTarget = target as typeof target & { deliveryDurationMinutesTotal?: number };
  durationTarget.deliveryDurationMinutesTotal =
    (durationTarget.deliveryDurationMinutesTotal ?? 0) + minutes;
  target.deliveryDurationMinutesSamples.push(minutes);
  target.deliveryTimeSampleCount += 1;
  target.averageDeliveryMinutes = calculateAverageDeliveryMinutes(target);
  target.medianDeliveryMinutes = calculateMedianDeliveryMinutes(target);
}

function calculateAverageDeliveryMinutes(target: {
  deliveryTimeSampleCount: number;
  averageDeliveryMinutes: number | null;
}): number | null {
  const durationTarget = target as typeof target & { deliveryDurationMinutesTotal?: number };
  if (target.deliveryTimeSampleCount === 0 || !durationTarget.deliveryDurationMinutesTotal) {
    return null;
  }

  return Math.round((durationTarget.deliveryDurationMinutesTotal / target.deliveryTimeSampleCount) * 10) / 10;
}

function calculateMedianDeliveryMinutes(target: {
  deliveryDurationMinutesSamples?: number[];
}): number | null {
  const samples = [...(target.deliveryDurationMinutesSamples ?? [])]
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .sort((a, b) => a - b);
  if (samples.length === 0) {
    return null;
  }

  const middle = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 0 ? (samples[middle - 1] + samples[middle]) / 2 : samples[middle];
  return Math.round(median * 10) / 10;
}

function localDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isMessageInsideScanInterval(message: ParsedDeliveryMessage, fromMs: number, toMs: number): boolean {
  if (!message.usesRestaurantSchedule || !isWholeLocalDayRange(fromMs, toMs)) {
    return message.timestampMs >= fromMs && message.timestampMs <= toMs;
  }

  const fromDay = localDateKey(fromMs);
  const toDay = localDateKey(toMs);
  return message.reportDayKey >= fromDay && message.reportDayKey <= toDay;
}

function isWholeLocalDayRange(fromMs: number, toMs: number): boolean {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const startsAtDayStart = from.getHours() === 0 && from.getMinutes() === 0 && from.getSeconds() === 0;
  const endsAtDayEnd = to.getHours() === 23 && to.getMinutes() >= 59;
  return startsAtDayStart && endsAtDayEnd;
}

function isNightTimestamp(timestampMs: number): boolean {
  const hour = new Date(timestampMs).getHours();
  return hour >= 23 || hour < 4;
}

function reportDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (date.getHours() < 4) {
    date.setDate(date.getDate() - 1);
  }

  return localDateKey(date.getTime());
}

function formatDayKeyLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return new Intl.DateTimeFormat('ro-RO', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatLocalDateLabel(timestampMs: number): string {
  return new Intl.DateTimeFormat('ro-RO', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestampMs));
}

function messageId(sourceFile: string, lineNumber: number, rawLine: string): string {
  return `msg-${hashString(`${sourceFile}:${lineNumber}:${rawLine}`)}`;
}

function availabilityMessageId(sourceFile: string, lineNumber: number, rawLine: string): string {
  return `availability-${hashString(`${sourceFile}:${lineNumber}:${rawLine}`)}`;
}

function conversationLineId(sourceFile: string, lineNumber: number, rawLine: string): string {
  return `line-${hashString(`${sourceFile}:${lineNumber}:${rawLine}`)}`;
}

function sourceFileId(sourceFile: string): string {
  return `source-${hashString(sourceFile)}`;
}

function inferSourceKind(
  sourceFile: string,
  groupName: string,
  deliveryCount: number,
  availabilityCount: number,
): SourceKind {
  if (availabilityCount === 0) {
    return 'restaurant';
  }

  const normalizedName = normalizeWord(`${sourceFile} ${groupName}`);
  const nameSuggestsAvailability =
    /\b(pontaj|program|disponibilitate|livrari)\b/.test(normalizedName) ||
    normalizedName.includes('bunicu costi');

  if (nameSuggestsAvailability && availabilityCount >= 2) {
    return 'availability';
  }

  if (deliveryCount === 0) {
    return 'availability';
  }

  if (availabilityCount >= 5 && availabilityCount >= deliveryCount * 2) {
    return 'availability';
  }

  return 'restaurant';
}

function issueId(sourceFile: string, lineNumber: number, code: string): string {
  return `issue-${hashString(`${sourceFile}:${lineNumber}:${code}`)}`;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function inferRestaurantName(sourceFile: string): string {
  const normalizedSeparators = sourceFile.replace(/\\/g, '/');
  const lastPart = normalizedSeparators.split('/').at(-1) ?? sourceFile;
  const withoutExtension = lastPart.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension
    .replace(/^Conversa[țt]ie WhatsApp cu\s+/i, '')
    .replace(/^WhatsApp Chat with\s+/i, '')
    .replace(/[^\p{L}\p{N}\s&.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || withoutExtension || 'Restaurant necunoscut';
}
