// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

function run(command, args, cwd) {
  return execFileSync(command, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
}

function getExportPaths(value) {
  if (typeof value === 'string') return [value.replace(/^\.\//, '')];
  return value ? Object.values(value).flatMap(getExportPaths) : [];
}

// Only staged manifests change. Keep upstream versions for peer compatibility;
// the immutable release URL and gitHead identify the fork revision.
export function createReleaseManifest(manifest, urls, {repository, tag, commit}) {
  const result = structuredClone(manifest);
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const name of Object.keys(result[field] || {})) {
      if (urls[name]) result[field][name] = urls[name];
    }
  }
  // npm otherwise auto-installs missing peers from the public npm registry.
  for (const name of Object.keys(result.peerDependencies || {})) {
    if (urls[name] && !result.peerDependenciesMeta?.[name]?.optional) {
      result.dependencies ||= {};
      result.dependencies[name] = urls[name];
    }
  }
  result.repository = {type: 'git', url: `https://github.com/${repository}.git`};
  result.bugs = {url: `https://github.com/${repository}/issues`};
  result.gitHead = commit;
  result.hulaRelease = tag;
  delete result.scripts;
  delete result.devDependencies;
  delete result.publishConfig;
  return result;
}

/** Pack every built workspace and write install URLs, checksums and release notes. */
export async function packRelease({
  root = ROOT,
  output = join(root, 'dist/github-release'),
  repository = 'hulaearth/deck.gl',
  tag,
  assetBaseUrl
}) {
  const {version} = JSON.parse(await readFile(join(root, 'lerna.json'), 'utf8'));
  if (!/^[-\w.]+\/[-\w.]+$/.test(repository) || !/^v\d+\.\d+\.\d+-hula\.\d+$/.test(tag)) {
    throw new Error('Expected repository owner/name and tag vX.Y.Z-hula.N');
  }
  if (!tag.startsWith(`v${version}-hula.`)) {
    throw new Error(`Release tag must use workspace version ${version}`);
  }
  const commit = run('git', ['rev-parse', 'HEAD'], root).trim();
  const packages = [];
  for (const entry of await readdir(join(root, 'modules'), {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, 'modules', entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private) continue;
    if (manifest.version !== version) throw new Error(`Version mismatch: ${manifest.name}`);
    packages.push({directory, manifest});
  }
  if (!packages.length) throw new Error('No publishable workspaces found');
  packages.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const baseUrl = assetBaseUrl || `https://github.com/${repository}/releases/download/${tag}`;
  const urls = Object.fromEntries(
    packages.map(({manifest}) => [
      manifest.name,
      `${baseUrl}/${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`
    ])
  );
  // Refuse to mix artifacts from different builds or overwrite an existing set.
  await mkdir(output, {recursive: true});
  if ((await readdir(output)).length) throw new Error(`Output directory must be empty: ${output}`);
  const temporary = await mkdtemp(join(tmpdir(), 'deck-release-'));
  const checksums = [];
  try {
    for (const {directory, manifest} of packages) {
      const [original] = JSON.parse(
        run(
          'npm',
          ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
          directory
        )
      );
      const files = new Set(original.files.map(file => file.path));
      const required = [
        manifest.main,
        manifest.module,
        manifest.types,
        ...getExportPaths(manifest.exports),
        ...(manifest.files || []).filter(file => file.endsWith('.js'))
      ].filter(Boolean);
      for (const file of required) {
        if (!files.has(file.replace(/^\.\//, ''))) {
          throw new Error(`${manifest.name}: missing ${file}; run yarn build and prepublishOnly`);
        }
      }
      run('tar', ['-xzf', join(temporary, original.filename), '-C', temporary], root);
      const staging = join(temporary, 'package');
      const releaseManifest = createReleaseManifest(manifest, urls, {repository, tag, commit});
      await writeFile(
        join(staging, 'package.json'),
        `${JSON.stringify(releaseManifest, null, 2)}\n`
      );
      const [packed] = JSON.parse(
        run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], staging)
      );
      const archive = await readFile(join(output, packed.filename));
      checksums.push(`${createHash('sha256').update(archive).digest('hex')}  ${packed.filename}`);
      await rm(staging, {recursive: true});
      await rm(join(temporary, original.filename));
      console.log(`Packed ${manifest.name}`);
    }
    await writeFile(
      join(output, 'dependencies.json'),
      `${JSON.stringify({dependencies: urls}, null, 2)}\n`
    );
    await writeFile(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
    await writeFile(
      join(output, 'release-notes.md'),
      `deck.gl ${version} with the Hula globe IconLayer fix.\n\n` +
        `Source: ${commit}. Package versions remain ${version} for peer compatibility.\n\n` +
        'All workspaces are available as npm tarballs. Required deck.gl dependencies resolve to this release. ' +
        'Copy the packages you use from dependencies.json into package.json, run npm install, ' +
        'and commit package-lock.json. Keep existing @deck.gl imports.\n\n' +
        'See [installation and release instructions]' +
        `(https://github.com/${repository}/blob/${tag}/dev-docs/hula-releases.md).\n`
    );
    return urls;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, repository = 'hulaearth/deck.gl'] = process.argv.slice(2);
  await access(join(ROOT, 'modules/core/dist/index.js'));
  await packRelease({tag, repository});
}
