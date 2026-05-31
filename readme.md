# nftrs

Fast Node.js dependency tracing, powered by Rust and
[OXC](https://oxc.rs).

`nftrs` finds the files a Node.js entry point needs at runtime: source files,
package files, assets loaded through `fs`, and native addons. It is a native
rewrite of [`@vercel/nft`](https://github.com/vercel/nft) with a drop-in
`nodeFileTrace` API.

Use it when you need to build a minimal deployable output, copy only the files a
server needs, or make `@vercel/nft`-style tracing faster in a build pipeline.

## Install

```bash
npm install @nftrs/core
```

Prebuilt native packages are currently published for:

- macOS x64 / arm64
- Linux x64 / arm64 glibc
- Windows x64 MSVC

Node.js 20 or newer is recommended.

## Quick Start

```js
const { nodeFileTrace } = require('@nftrs/core');

async function main() {
  const result = await nodeFileTrace(['./server.js'], {
    base: process.cwd(),
  });

  console.log(result.fileList);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`fileList` contains paths relative to `base`. Copy those files into your output
directory to produce a minimal runtime bundle.

```js
const { cp, mkdir } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const { nodeFileTrace } = require('@nftrs/core');

async function main() {
  const { fileList } = await nodeFileTrace(['./server.js']);

  for (const file of fileList) {
    const out = join('dist', file);
    await mkdir(dirname(out), { recursive: true });
    await cp(file, out);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## Migrating From `@vercel/nft`

For the common API path, only the import changes:

```diff
- const { nodeFileTrace } = require('@vercel/nft');
+ const { nodeFileTrace } = require('@nftrs/core');
```

The call shape and result shape follow `@vercel/nft`:

```ts
nodeFileTrace(files, options) => {
  fileList,
  esmFileList,
  reasons,
  warnings,
}
```

Common options include `base`, `processCwd`, `depth`, `ts`, `analysis`,
`conditions`, `exportsOnly`, `moduleSyncCatchall`, `paths`, `resolve`, and
`ignore`.

## CLI

After installing `@nftrs/core`, the `nftrs` binary is available:

```bash
npx nftrs print ./server.js
npx nftrs build ./server.js
npx nftrs size ./server.js
npx nftrs why ./server.js node_modules/some-package/index.js
```

Commands:

- `print`: print the traced runtime file list
- `build`: copy traced files to `dist/`
- `size`: print total traced file size
- `why`: print why a file was included

## Why nftrs?

`@vercel/nft` is widely used and has a practical API, but its tracing work runs
as JavaScript AST walking. `nftrs` keeps the same model while moving parsing,
resolution, and analysis into Rust on top of OXC.

That gives this project a narrow goal:

- keep `nodeFileTrace` easy to swap in
- preserve the useful `@vercel/nft` behavior
- make dependency tracing cheap enough to run more often

## Status

`nftrs` is validated against `@vercel/nft`'s upstream fixture suite and an
end-to-end Misskey compatibility harness. Compatibility and performance are
still active work, so pin versions in production and test your own dependency
graph before replacing an existing tracer.

Useful local checks:

```bash
node compat/run.mjs --check
node compat/bench.mjs
cargo test --workspace
```

## License

MIT
