import { spawn } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
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

  const latestYml = await readFile(path.join(releaseDir, 'latest.yml'), 'utf8');
  if (!latestYml.includes(`version: ${version}`) || !latestYml.includes(expectedInstaller)) {
    throw new Error('latest.yml nu corespunde versiunii sau installerului din release/. Ruleaza mai intai npm run pack:win si npm run hash:release.');
  }

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
  ]);

  console.log(`Release ${tag} publicat cu artefactele deja verificate din release/.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
