import { deserializeImportResult } from './import-storage';
import type { ReportImport, ReviewRow, StoredReportImport } from './types';

export function buildReviewContext(imports: StoredReportImport[], row: ReviewRow): ReportImport[] {
  const anchors = row.kind === 'metric-source' ? row.sourceAnchors ?? [] : [];
  const ids = new Set(row.kind === 'mismatch' || row.kind === 'metric-source' ? row.sourceMessageIds : [row.id]);
  const result: ReportImport[] = [];
  for (const stored of imports) {
    if (anchors.length && anchors.every((anchor) => anchor.reportImportId) && !anchors.some((anchor) => anchor.reportImportId === stored.id)) continue;
    const imported = deserializeImportResult(stored.importResultJson);
    const files = imported.files.flatMap((file) => {
      const fileAnchors = anchors.filter((anchor) => anchor.sourceId === file.sourceId && (!anchor.reportImportId || anchor.reportImportId === stored.id));
      const messages = file.messages.filter((message) => ids.has(message.id));
      const availabilityMessages = file.availabilityMessages.filter((message) => ids.has(message.id));
      const lineNumbers = [...fileAnchors.map((anchor) => anchor.lineNumber), ...messages.map((message) => message.lineNumber), ...availabilityMessages.map((message) => message.lineNumber)];
      if (row.kind !== 'mismatch' && row.kind !== 'metric-source' && file.sourceId === row.sourceId) {
        const sourceLine = file.conversationLines.find((line) => line.lineNumber === row.lineNumber);
        if (sourceLine?.rawLine === row.rawLine) lineNumbers.push(row.lineNumber);
      }
      if (!lineNumbers.length) return [];
      const targets = lineNumbers.slice(0, 160).map((lineNumber) => file.conversationLines.findIndex((line) => line.lineNumber === lineNumber)).filter((index) => index >= 0);
      const visibleIndexes = new Set<number>();
      for (const target of targets) {
        for (let index = Math.max(0, target - 160); index <= Math.min(file.conversationLines.length - 1, target + 160); index += 1) visibleIndexes.add(index);
      }
      return [{ ...file, messages, availabilityMessages, issues: [], conversationLines: file.conversationLines.filter((_line, index) => visibleIndexes.has(index)) }];
    });
    if (!files.length) continue;
    const { importResultJson: _json, ...summary } = stored;
    result.push({ ...summary, importResult: { importedAtIso: imported.importedAtIso, files,
      messages: files.flatMap((file) => file.messages), availabilityMessages: files.flatMap((file) => file.availabilityMessages), issues: [] } });
  }
  return result;
}
