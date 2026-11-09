import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ParserTask } from './parser-tasks';
import type { ImportResult, ReportImport, ScanReport } from '../src/shared/types';

let activeWorker: Worker | null = null;
let queuedContext: {
  task: Extract<ParserTask, { kind: 'context' }>;
  resolve: (result: ReportImport[]) => void;
  reject: (error: Error) => void;
} | null = null;

export function stopParserTasks(): void {
  queuedContext?.reject(new Error('Aplicatia se inchide.'));
  queuedContext = null;
  void activeWorker?.terminate();
}

export function runParserTask(task: Extract<ParserTask, { kind: 'import' }>): Promise<ImportResult>;
export function runParserTask(task: Extract<ParserTask, { kind: 'scan' }>): Promise<ScanReport>;
export function runParserTask(task: Extract<ParserTask, { kind: 'context' }>): Promise<ReportImport[]>;
export function runParserTask(task: ParserTask): Promise<ImportResult | ScanReport | ReportImport[]> {
  if (activeWorker) {
    if (task.kind !== 'context') return Promise.reject(new Error('O procesare este deja in lucru. Asteapta finalizarea ei.'));
    queuedContext?.reject(new Error('Selectia mesajului a fost inlocuita.'));
    return new Promise<ReportImport[]>((resolve, reject) => { queuedContext = { task, resolve, reject }; });
  }
  return new Promise((resolve, reject) => {
    const workerFile = path.join(__dirname, 'parser-worker.js').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    const worker = new Worker(workerFile, { workerData: task });
    activeWorker = worker;
    let settled = false;
    const finish = (error: Error | null, result?: ImportResult | ScanReport | ReportImport[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeAllListeners();
      const complete = (terminationError?: Error): void => {
        if (activeWorker === worker) activeWorker = null;
        if (error || terminationError) reject(error ?? terminationError!);
        else resolve(result!);
        const pending = queuedContext;
        queuedContext = null;
        if (pending) void runParserTask(pending.task).then(pending.resolve, pending.reject);
      };
      void worker.terminate().then(() => complete(), (terminationError: Error) => complete(terminationError));
    };
    const timeout = setTimeout(() => finish(new Error('Procesarea a depasit timpul permis. Redu intervalul sau marimea conversatiei si incearca din nou.')), 120_000);
    worker.once('message', (message: { ok: boolean; error?: string; result?: ImportResult | ScanReport | ReportImport[] }) => {
      finish(message.ok ? null : new Error(message.error ?? 'Procesarea a esuat.'), message.result);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => finish(new Error(`Procesarea s-a oprit inainte de finalizare (${code}).`)));
  });
}
