import { parentPort, workerData } from 'node:worker_threads';
import { executeParserTask, type ParserTask } from './parser-tasks';

try {
  const result = executeParserTask(workerData as ParserTask);
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Procesarea conversatiei a esuat.' });
} finally {
  parentPort?.close();
}
