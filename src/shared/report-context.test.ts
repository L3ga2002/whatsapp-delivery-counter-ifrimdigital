import { describe, expect, it } from 'vitest';
import { parseImportedTexts } from './parser';
import { serializeImportResult } from './import-storage';
import { buildReviewContext } from './report-context';
import type { MetricSourceReviewRow, StoredReportImport } from './types';

describe('on-demand source context', () => {
  it('keeps exact anchors and bounds the payload even when two imports have identical source ids', () => {
    const text = Array.from({ length: 800 }, (_, index) => `02.11.2026, 12:00 - Curier test: Ridicat x1\n02.11.2026, 12:10 - Curier test: Livrat x1`).join('\n');
    const imported = parseImportedTexts([{ sourceFile: 'chat.txt', text, bytes: text.length }]);
    const message = imported.messages[800];
    const stored: StoredReportImport = { id: 'wanted-import', reportId: 'report', role: 'restaurant', restaurantId: 'restaurant',
      sourceLabel: 'Test', importedAtIso: '', fileCount: 1, messageCount: imported.messages.length, availabilityMessageCount: 0,
      issueCount: 0, importResultJson: serializeImportResult(imported) };
    const row: MetricSourceReviewRow = { kind: 'metric-source', id: 'metric-row', severity: 'warning', restaurantName: 'Test', courierName: 'Curier test',
      reason: '', sourceMessageIds: [message.id], sourceAnchors: [{ id: 'anchor', reportImportId: stored.id, sourceId: message.sourceId,
        sourceFile: message.sourceFile, lineNumber: message.lineNumber, role: 'pickup' }] };
    const context = buildReviewContext([{ ...stored, id: 'wrong-import' }, stored], row);
    expect(context).toHaveLength(1);
    expect(context[0].id).toBe('wanted-import');
    expect(context[0].importResult.files[0].conversationLines).toHaveLength(321);
    expect(context[0].importResult.files[0].conversationLines.find((line) => line.lineNumber === message.lineNumber)?.rawLine).toBe(message.rawLine);
    expect(context[0].importResult.messages.map((item) => item.id)).toEqual([message.id]);
  });
});
