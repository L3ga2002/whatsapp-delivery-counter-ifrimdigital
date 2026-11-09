import { describe, expect, it } from 'vitest';
import { parseImportedTexts } from './parser';
import { deserializeImportResult, serializeImportResult } from './import-storage';

describe('compact import storage', () => {
  it('stores message arrays once and restores the exact source lines and message identities', () => {
    const text = '02.11.2026, 12:00 - Curier test: Ridicat x2 (1 x zona 2)\n02.11.2026, 12:10 - Curier test: Livrat x2';
    const result = parseImportedTexts([{ sourceFile: 'chat.txt', text, bytes: text.length }]);
    const json = serializeImportResult(result);
    expect(json.length).toBeLessThan(JSON.stringify(result).length);
    expect(JSON.parse(json).messages).toEqual([]);
    const restored = deserializeImportResult(json);
    expect(restored).toEqual(result);
    expect(restored.messages[0]).toBe(restored.files[0].messages[0]);
    expect(deserializeImportResult(JSON.stringify(result))).toEqual(result);
  });

  it('preserves a legacy import that only has root message arrays', () => {
    const result = { importedAtIso: '', files: [], messages: [], availabilityMessages: [], issues: [] };
    expect(deserializeImportResult(serializeImportResult(result))).toEqual(result);
  });
});
