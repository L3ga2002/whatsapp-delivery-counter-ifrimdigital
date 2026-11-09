import { applyRestaurantScheduleContext, buildScanReport, filterMessagesForRestaurantSchedule, parseWhatsAppExport } from './parser';
import { hydrateReportImport } from './import-storage';
import type { AliasMap, ConversationLine, ParsedAvailabilityMessage, ParsedDeliveryMessage, ReportImport, Restaurant, ScanInterval, ScanOptions, ScanReport, StoredReportImport } from './types';

function restoreConversationText(lines: ConversationLine[]): string {
  const chunks: string[] = [];
  let nextLine = 1;
  for (const line of lines) {
    const gap = line.lineNumber - nextLine;
    if (!Number.isInteger(gap) || gap < 0 || gap > 30 * 1024 * 1024) throw new Error('Coordonate sursa invalide. Reimporta conversatia.');
    chunks.push('\n'.repeat(gap) + line.rawLine);
    nextLine = line.lineNumber + line.rawLine.split('\n').length;
  }
  return chunks.join('\n');
}

export function materializeReportInputs(imports: ReportImport[], restaurants: Restaurant[], options: ScanOptions): {
  messages: ParsedDeliveryMessage[];
  availabilityMessages: ParsedAvailabilityMessage[];
} {
  const selectedRestaurantIds = options.includeAllRestaurants === false ? new Set(options.restaurantIds ?? []) : null;
  const messages: ParsedDeliveryMessage[] = [];
  const availabilityMessages: ParsedAvailabilityMessage[] = [];
  for (const reportImport of imports) {
    const restaurant = reportImport.restaurantId ? restaurants.find((item) => item.id === reportImport.restaurantId) : null;
    const restaurantAllowed = !selectedRestaurantIds || (reportImport.restaurantId ? selectedRestaurantIds.has(reportImport.restaurantId) : false);
    const displayName = restaurant?.name ?? reportImport.sourceLabel;
    if ((reportImport.role === 'restaurant' || reportImport.role === 'mixed') && restaurantAllowed) {
      const files = reportImport.importResult.files?.length
        ? reportImport.importResult.files
        : [{ messages: reportImport.importResult.messages, conversationLines: [] }];
      for (const file of files) {
        const hasRetainedConversation = 'sourceFile' in file && file.conversationLines.length > 0;
        const reparsedFile = hasRetainedConversation
          ? parseWhatsAppExport(restoreConversationText(file.conversationLines), file.sourceFile, file.bytes, file.restaurantName)
          : file;
        const sourceMessages = hasRetainedConversation ? reparsedFile.messages : reparsedFile.messages.map((message) => ({
          ...message,
          autoCountable: false,
          needsReview: true,
          reviewReasons: Array.from(new Set([...message.reviewReasons, 'Import vechi fara liniile conversatiei: reimporta fisierul pentru recalculare sigura.'])),
        }));
        const scheduledMessages = filterMessagesForRestaurantSchedule(
          applyRestaurantScheduleContext(sourceMessages, reparsedFile.conversationLines, restaurant?.schedule), restaurant?.schedule,
        );
        messages.push(...scheduledMessages.map((message) => ({
          ...message,
          reportImportId: reportImport.id,
          restaurantId: reportImport.restaurantId ?? undefined,
          restaurantName: displayName,
        })));
      }
    }
    if (reportImport.role === 'workHours' || reportImport.role === 'mixed') {
      const files = reportImport.importResult.files?.length ? reportImport.importResult.files
        : [{ availabilityMessages: reportImport.importResult.availabilityMessages }];
      availabilityMessages.push(...files.flatMap((file) => file.availabilityMessages.map((message) => ({ ...message, restaurantName: displayName }))));
    }
  }
  return { messages, availabilityMessages };
}

export function scanStoredReport(imports: StoredReportImport[], restaurants: Restaurant[], interval: ScanInterval, aliases: AliasMap, options: ScanOptions): ScanReport {
  const { messages, availabilityMessages } = materializeReportInputs(imports.map(hydrateReportImport), restaurants, options);
  return buildScanReport(messages, interval, aliases, availabilityMessages, options);
}
