import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const hashFile = path.join(releaseDir, 'SHA256SUMS.txt');
const allowedExtensions = new Set(['.exe', '.blockmap']);

async function main() {
  const files = await readdir(releaseDir, { withFileTypes: true });
  const releaseFiles = files
    .filter((entry) => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(releaseDir, entry.name));
  if (releaseFiles.length === 0) {
    throw new Error('Nu exista artefacte release pentru hash in folderul release/.');
  }

  const lines = [];
  for (const file of releaseFiles.sort((a, b) => a.localeCompare(b))) {
    const buffer = await readFile(file);
    const hash = createHash('sha256').update(buffer).digest('hex');
    lines.push(`${hash}  ${path.relative(releaseDir, file).replace(/\\/g, '/')}`);
  }

  await writeFile(hashFile, `${lines.join('\n')}\n`, 'utf8');
  console.log(`SHA-256 hashes written to ${hashFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
