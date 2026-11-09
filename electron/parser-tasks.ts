import { parseImportedTexts } from '../src/shared/parser';
import { scanStoredReport } from '../src/shared/report-inputs';
import { buildReviewContext } from '../src/shared/report-context';
import type { AliasMap, ImportResult, ReportImport, Restaurant, ReviewRow, ScanInterval, ScanOptions, ScanReport, StoredReportImport } from '../src/shared/types';

export interface ParserSourceText {
  sourceFile: string;
  text: string;
  bytes: number;
  restaurantName?: string;
}

export type ParserTask =
  | { kind: 'import'; texts: ParserSourceText[] }
  | { kind: 'scan'; imports: StoredReportImport[]; restaurants: Restaurant[]; interval: ScanInterval; aliases: AliasMap; options: ScanOptions }
  | { kind: 'context'; imports: StoredReportImport[]; row: ReviewRow };

export function executeParserTask(task: ParserTask): ImportResult | ScanReport | ReportImport[] {
  if (task.kind === 'import') return parseImportedTexts(task.texts);
  if (task.kind === 'context') return buildReviewContext(task.imports, task.row);
  return scanStoredReport(task.imports, task.restaurants, task.interval, task.aliases, task.options);
}
