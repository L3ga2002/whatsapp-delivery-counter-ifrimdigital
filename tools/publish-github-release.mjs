import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const repo = 'L3ga2002/whatsapp-delivery-counter-ifrimdigital-releases';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} a iesit cu codul ${code}.`));
      }
    });
  });
}

async function readVersion() {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  return packageJson.version;
}

async function sha512Base64(filePath) {
  const content = await readFile(filePath);
  return createHash('sha512').update(content).digest('base64');
}

async function verifyHashManifest(assets) {
  const manifest = await readFile(path.join(releaseDir, 'SHA256SUMS.txt'), 'utf8');
  const hashes = new Map(
    manifest
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line.trim());
        if (!match) throw new Error(`Linie SHA-256 invalida: ${line}`);
        return [match[2], match[1]];
      }),
  );

  for (const asset of assets.filter((name) => name.endsWith('.exe') || name.endsWith('.blockmap'))) {
    const expected = hashes.get(asset);
    if (!expected) throw new Error(`SHA256SUMS.txt nu contine ${asset}.`);
    const actual = createHash('sha256').update(await readFile(path.join(releaseDir, asset))).digest('hex');
    if (actual !== expected) throw new Error(`Hash SHA-256 invalid pentru ${asset}.`);
  }
}

async function verifyLatestYaml(version, installer) {
  const filePath = path.join(releaseDir, 'latest.yml');
  const latestYml = await readFile(filePath, 'utf8');
  const expectedInstallerPath = path.join(releaseDir, installer);
  const [installerSize, installerSha512] = await Promise.all([
    stat(expectedInstallerPath).then((entry) => entry.size),
    sha512Base64(expectedInstallerPath),
  ]);
  const escapedInstaller = installer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const installerEntry = new RegExp(`- url: ${escapedInstaller}\\r?\\n\\s+sha512: ([^\\r\\n]+)\\r?\\n\\s+size: (\\d+)`).exec(latestYml);
  const topLevelPath = /^path:\s*(.+)$/m.exec(latestYml)?.[1]?.trim();
  const topLevelSha512 = /^sha512:\s*(.+)$/m.exec(latestYml)?.[1]?.trim();
  const topLevelSize = /^size:\s*(\d+)$/m.exec(latestYml)?.[1];

  if (!new RegExp(`^version:\\s*${version}$`, 'm').test(latestYml) || !installerEntry) {
    throw new Error('latest.yml nu corespunde versiunii sau installerului din release/.');
  }
  if (installerEntry[1] !== installerSha512 || Number(installerEntry[2]) !== installerSize) {
    throw new Error('latest.yml are SHA-512 sau dimensiune invalida pentru installer.');
  }
  if (topLevelPath !== installer || topLevelSha512 !== installerSha512 || Number(topLevelSize) !== installerSize) {
    throw new Error('latest.yml are metadate top-level invalide pentru installer.');
  }
}

async function main() {
  const version = await readVersion();
  const tag = `v${version}`;
  const expectedInstaller = `WhatsApp-Delivery-Counter-${version}-Installer-x64.exe`;
  const expectedBlockmap = `${expectedInstaller}.blockmap`;
  const expectedPortable = `WhatsApp-Delivery-Counter-${version}-Portable-x64.exe`;
  const assets = [expectedInstaller, expectedBlockmap, expectedPortable, 'latest.yml', 'SHA256SUMS.txt'];

  for (const asset of assets) {
    await access(path.join(releaseDir, asset));
  }

  await Promise.all([
    verifyLatestYaml(version, expectedInstaller),
    verifyHashManifest(assets),
  ]);

  const entries = await readdir(releaseDir);
  if (entries.some((entry) => entry.includes('0.3.') && !entry.includes(version) && entry.endsWith('.exe'))) {
    console.warn('Exista artefacte mai vechi in release/. Vor fi ignorate; sunt incarcate doar artefactele versiunii curente.');
  }

  const assetPaths = assets.map((asset) => path.join('release', asset));
  await run('gh', [
    'release',
    'create',
    tag,
    ...assetPaths,
    '--repo',
    repo,
    '--title',
    `WhatsApp Delivery Counter ${version}`,
    '--notes',
    `Release ${version}. Artefactele au fost impachetate si verificate local inainte de publicare.`,
    '--draft',
  ]);

  await run('gh', [
    'release',
    'edit',
    tag,
    '--repo',
    repo,
    '--draft=false',
  ]);

  console.log(`Release ${tag} publicat dupa validarea locala a artefactelor din release/.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
