// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {packRelease} from './pack-github-release.mjs';

// Exercise real tarball installs outside the Yarn workspace before publishing.
// Serve a separate local copy so npm can follow the entire fork dependency graph.
const root = resolve(import.meta.dirname, '..');
const [tag, repository = 'hulaearth/deck.gl'] = process.argv.slice(2);
const temporary = await mkdtemp(join(tmpdir(), 'deck-release-test-'));
const output = join(temporary, 'packages');
const execute = promisify(execFile);
let assets = new Set();
const server = createServer((request, response) => {
  const name = request.url.slice(1);
  if (!assets.has(name)) {
    response.writeHead(404).end();
    return;
  }
  createReadStream(join(output, name)).pipe(response);
});

try {
  await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const urls = await packRelease({root, output, repository, tag, assetBaseUrl: baseUrl});
  assets = new Set(await readdir(output));
  const names = ['core', 'extensions', 'geo-layers', 'layers', 'mapbox', 'mesh-layers'];
  const dependencies = Object.fromEntries(
    names.map(name => [`@deck.gl/${name}`, urls[`@deck.gl/${name}`]])
  );
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({name: 'deck-fork-smoke-test', private: true, type: 'module', dependencies})
  );
  await execute('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: temporary,
    maxBuffer: 10 * 1024 * 1024
  });
  await execute('npm', ['ls', '--all'], {cwd: temporary, maxBuffer: 10 * 1024 * 1024});
  const lock = JSON.parse(await readFile(join(temporary, 'package-lock.json'), 'utf8'));
  let checked = 0;
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!/(?:^|\/)node_modules\/@deck\.gl\/[^/]+$/.test(path)) continue;
    assert.ok(
      metadata.resolved.startsWith(`${baseUrl}/`),
      `Unexpected upstream dependency: ${path}`
    );
    const manifest = JSON.parse(await readFile(join(temporary, path, 'package.json'), 'utf8'));
    assert.equal(manifest.hulaRelease, tag, path);
    checked++;
  }
  assert.equal(checked, names.length, 'Each deck.gl module must have one shared installation');
  await writeFile(
    join(temporary, 'entry.js'),
    `export {Deck} from '@deck.gl/core';
export {DataFilterExtension} from '@deck.gl/extensions';
export {TileLayer} from '@deck.gl/geo-layers';
export {IconLayer, ScatterplotLayer} from '@deck.gl/layers';
export {MapboxOverlay} from '@deck.gl/mapbox';
export {SimpleMeshLayer} from '@deck.gl/mesh-layers';\n`
  );
  for (const webglOnly of [false, true]) {
    await writeFile(
      join(temporary, 'vite.config.mjs'),
      `export default ${JSON.stringify({
        resolve: {
          conditions: webglOnly ? ['visgl:webgl-only', 'module', 'browser'] : ['module', 'browser']
        },
        build: {lib: {entry: 'entry.js', formats: ['es'], fileName: 'deck'}, minify: false}
      })};\n`
    );
    await execute(join(root, 'node_modules/.bin/vite'), ['build'], {
      cwd: temporary,
      maxBuffer: 10 * 1024 * 1024
    });
  }
  console.log('Fresh npm install, dependency deduplication and both Vite builds passed.');
} finally {
  await new Promise(resolveClosed => server.close(resolveClosed));
  await rm(temporary, {recursive: true, force: true});
}
