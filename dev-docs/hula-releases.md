# Installing and releasing the Hula fork

This fork distributes built npm packages as public GitHub release assets. No npm
registry credentials or Git checkout are needed in the consuming application.
All 17 publishable workspaces, including the `deck.gl` umbrella package, are packed.

## Install in a SvelteKit project using npm

The first release is `v9.4.0-hula.1`: upstream deck.gl 9.4.0 plus the globe IconLayer
winding fix. Replace the existing six dependencies in `package.json` with:

```json
{
  "@deck.gl/core": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-core-9.4.0.tgz",
  "@deck.gl/extensions": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-extensions-9.4.0.tgz",
  "@deck.gl/geo-layers": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-geo-layers-9.4.0.tgz",
  "@deck.gl/layers": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-layers-9.4.0.tgz",
  "@deck.gl/mapbox": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-mapbox-9.4.0.tgz",
  "@deck.gl/mesh-layers": "https://github.com/hulaearth/deck.gl/releases/download/v9.4.0-hula.1/deck.gl-mesh-layers-9.4.0.tgz"
}
```

Run `npm install`, then your application's checks and production build. Commit
`package.json` and `package-lock.json`; CI can continue using `npm ci`. Existing
imports such as `import {IconLayer} from '@deck.gl/layers'` remain unchanged.
Initialize the map and deck.gl in the browser as usual, for example in `onMount`.
No SvelteKit aliases or custom npm registry configuration are required.

The release's `dependencies.json` contains URLs for every workspace. Install only
the packages your application uses, and keep all direct deck.gl dependencies on
the same release. Required deck.gl peers are also added as URL dependencies in the
packed manifests, so missing modules come from this fork. External dependencies
keep their upstream ranges. Optional peers remain optional.

The manifest versions remain `9.4.0` to satisfy existing peer ranges. The release
tag, tarball URL, `gitHead`, and `hulaRelease` manifest field identify the fork.
The string `9.4.0-hula.1` alone is not an npm registry version; use the full URL.

## Publish another release

Work from `codex/github-release-9.4` or a branch based on it. Keep all workspace
versions aligned with the upstream release in `lerna.json`. For another patch on
9.4.0, increment the Hula suffix to `v9.4.0-hula.2`.

Before tagging, run:

```sh
corepack enable yarn
yarn --frozen-lockfile
yarn build
yarn lerna run prepublishOnly --concurrency 1
yarn test-fast
node --test scripts/pack-github-release.test.mjs
yarn test-headless --reporter=dot test/modules/maplibre test/modules/mapbox
yarn test-render --reporter=dot test/render/test-cases/icon-layer.spec.ts test/render/test-cases/text-layer.spec.ts
node scripts/test-github-release.mjs v9.4.0-hula.2 hulaearth/deck.gl
```

Commit the changes, create the new tag, and push the branch and tag to `origin`.
The **Hula GitHub release** workflow repeats the checks, packs all modules, and
publishes a GitHub release containing the tarballs, install URLs, and SHA-256
checksums. GitHub Actions must be enabled in the fork. The workflow uses only its
built-in `GITHUB_TOKEN`; it does not publish to npm.

Packaging changes manifests only in temporary directories. It verifies exported
entry points and browser bundles are present. The npm smoke test installs the six
application packages in a fresh directory, checks for upstream copies or duplicate
deck.gl modules, and bundles both the default and `visgl:webgl-only` exports with
Vite. The workflow runs the render regressions with WebGL.

To inspect the final assets locally:

```sh
node scripts/pack-github-release.mjs v9.4.0-hula.2 hulaearth/deck.gl
```

They are written to the ignored `dist/github-release` directory, which must be
empty before packing. Published tags and assets must never be overwritten: update
the release suffix for every new build. Failed publication can be retried while
the release is still a draft.
