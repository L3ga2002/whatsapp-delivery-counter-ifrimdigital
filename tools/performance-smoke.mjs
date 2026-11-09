import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WorkspaceStore } = require(path.join(root, 'dist-electron/electron/workspace-store.js'));
const { runParserTask, stopParserTasks } = require(path.join(root, 'dist-electron/electron/parser-runner.js'));
const { serializeImportResult } = require(path.join(root, 'dist-electron/src/shared/import-storage.js'));

function medianTime(fn) {
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return Math.round(times.sort((a, b) => a - b)[1] * 10) / 10;
}

const text = Array.from({ length: 135 }, (_, index) => {
  const hour = 10 + Math.floor(index / 60);
  const minute = String(index % 60).padStart(2, '0');
  const courier = `Synthetic courier ${index % 15}`;
  return `02.11.2026, ${hour}:${minute} - ${courier}: Ridicat x1\n02.11.2026, ${hour + 1}:${minute} - ${courier}: Livrat x1`;
}).join('\n');

try {
  let ticks = 0;
  const heartbeat = setInterval(() => { ticks += 1; }, 5);
  let imported;
  try {
    const first = runParserTask({ kind: 'import', texts: [{ sourceFile: 'synthetic.txt', text, bytes: text.length }] });
    await assert.rejects(runParserTask({ kind: 'import', texts: [] }), /deja in lucru/);
    imported = await first;
  } finally {
    clearInterval(heartbeat);
  }
  assert(ticks > 0, 'The main event loop must remain responsive during parsing.');
  assert.equal(imported.messages.length, 270);

  const Sql = await require('sql.js')({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const db = new Sql.Database();
  const store = new WorkspaceStore('SYNTHETIC_IN_MEMORY_ONLY');
  store.db = db;
  store.migrate();
  const payload = serializeImportResult(imported);
  const rows = [];
  let inserted = 0;
  for (const count of [10, 50, 100]) {
    for (; inserted < count; inserted += 1) {
      const id = `report-${inserted}`;
      db.run('insert into reports values (?,?,?,?,?,?,?,?,?,?)', [id, 'Synthetic report', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', 'draft', '{}', '0.4.2', '', '', null]);
      db.run('insert into report_imports (id,report_id,role,restaurant_id,source_label,imported_at_iso,file_count,message_count,availability_count,issue_count,import_result_json) values (?,?,?,?,?,?,?,?,?,?,?)', [`import-${inserted}`, id, 'restaurant', null, 'Synthetic restaurant', '', 1, 270, 0, 0, payload]);
    }
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.reportImports.length, count);
    assert(snapshot.reportImports.every((item) => !('importResult' in item)));
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
    assert(snapshotBytes < 256 * 1024, 'Workspace metadata must remain small even with 100 historical imports.');
    rows.push({ imports: count, snapshotBytes, snapshotMs: medianTime(() => store.getSnapshot()) });
  }

  const stored = store.listStoredReportImports('report-0');
  let lastReport;
  for (let i = 0; i < 3; i += 1) {
    const report = await runParserTask({ kind: 'scan', imports: stored, restaurants: [],
      interval: { fromIso: '2026-11-02T00:00:00Z', toIso: '2026-11-03T00:00:00Z' }, aliases: {},
      options: { scanOrders: true, scanWorkHours: false, scanDeliveryTimes: true } });
    assert.equal(report.totalPickedUp, 135);
    assert.equal(report.summaries.length, 15);
    assert.equal(report.metricSources.length, 135);
    lastReport = report;
  }
  const source = lastReport.metricSources[0];
  const contextTask = { kind: 'context', imports: stored, row: { kind: 'metric-source', id: 'source-test', severity: 'warning',
    restaurantName: 'Renamed restaurant', courierName: source.courierName, sourceMessageIds: [source.pickupMessageId], reason: '',
    sourceAnchors: [{ id: 'pickup-anchor', reportImportId: source.reportImportId, sourceId: source.pickupSourceId,
      sourceFile: source.pickupSourceFile, lineNumber: source.pickupLineNumber, role: 'pickup' }] } };
  const firstContext = runParserTask(contextTask);
  const supersededContext = runParserTask(contextTask);
  const latestContext = runParserTask(contextTask);
  const superseded = assert.rejects(supersededContext, /inlocuita/);
  const [firstResult, latestResult] = await Promise.all([firstContext, latestContext, superseded]);
  assert.equal(firstResult[0].id, stored[0].id);
  assert.equal(latestResult[0].id, stored[0].id);
  db.close();
  console.log(JSON.stringify({ passed: true, scope: 'synthetic only; no client database accessed', workerHeartbeatTicks: ticks, workerScans: 3, latestContextQueue: 'passed', snapshots: rows }));
} finally {
  stopParserTasks();
}
