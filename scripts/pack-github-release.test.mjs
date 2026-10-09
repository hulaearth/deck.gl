// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReleaseManifest} from './pack-github-release.mjs';

test('release manifests keep required deck.gl modules in the same fork', () => {
  const manifest = {
    name: '@deck.gl/example',
    version: '9.4.0',
    dependencies: {'@deck.gl/layers': '9.4.0', external: '^1.0.0'},
    peerDependencies: {'@deck.gl/core': '~9.4.0', '@deck.gl/widgets': '~9.4.0'},
    peerDependenciesMeta: {'@deck.gl/widgets': {optional: true}},
    optionalDependencies: {'@deck.gl/json': '9.4.0'},
    scripts: {prepare: 'build'},
    devDependencies: {typescript: '*'},
    exports: {'.': './dist/index.js'}
  };
  const urls = Object.fromEntries(
    ['core', 'layers', 'widgets', 'json'].map(name => [
      `@deck.gl/${name}`,
      `https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-${name}-9.4.0.tgz`
    ])
  );
  const result = createReleaseManifest(manifest, urls, {
    repository: 'hulaearth/deck.gl',
    tag: 'v9.4.0-hula.1',
    commit: 'test-commit'
  });
  assert.deepEqual(result.dependencies, {
    '@deck.gl/layers': urls['@deck.gl/layers'],
    '@deck.gl/core': urls['@deck.gl/core'],
    external: '^1.0.0'
  });
  assert.deepEqual(result.optionalDependencies, {'@deck.gl/json': urls['@deck.gl/json']});
  assert.deepEqual(result.peerDependencies, manifest.peerDependencies);
  assert.deepEqual(result.exports, manifest.exports);
  assert.equal(result.version, '9.4.0');
  assert.equal(result.hulaRelease, 'v9.4.0-hula.1');
  assert.equal(result.gitHead, 'test-commit');
  assert.equal(result.scripts, undefined);
  assert.equal(result.devDependencies, undefined);
  assert.equal(manifest.dependencies['@deck.gl/layers'], '9.4.0');
  assert.ok(manifest.scripts);
});
