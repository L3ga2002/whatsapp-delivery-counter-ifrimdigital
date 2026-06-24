import { rm } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const projectRoot = process.cwd();
const relative = path.relative(projectRoot, releaseDir);

if (relative !== 'release') {
  throw new Error(`Refuz sa sterg un folder release in afara proiectului: ${releaseDir}`);
}

await rm(releaseDir, { recursive: true, force: true });
console.log(`Cleaned ${releaseDir}`);
