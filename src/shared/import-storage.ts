import type { ImportResult, ReportImport, StoredReportImport } from './types';

export function serializeImportResult(result: ImportResult): string {
  if (!result.files.length) return JSON.stringify(result);
  // File arrays already own these messages. Do not store a second JSON copy.
  return JSON.stringify({ ...result, messages: [], availabilityMessages: [], issues: [] });
}

export function deserializeImportResult(json: string): ImportResult {
  const result = JSON.parse(json) as ImportResult;
  if (!result.files?.length) return result;
  return {
    ...result,
    messages: result.files.flatMap((file) => file.messages ?? []),
    availabilityMessages: result.files.flatMap((file) => file.availabilityMessages ?? []),
    issues: result.files.flatMap((file) => file.issues ?? []),
  };
}

export function hydrateReportImport(stored: StoredReportImport): ReportImport {
  const { importResultJson, ...summary } = stored;
  return { ...summary, importResult: deserializeImportResult(importResultJson) };
}
