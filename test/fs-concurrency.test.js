'use strict';

// Converted from jest to Vitest.
// graceful-fs is mocked so we can drive its `promises.readFile` by hand and
// assert how CachedFileSystem serializes file IO. `vi.mock` is hoisted above
// every import, so the shared `pendingReads` queue is created with
// `vi.hoisted` to keep it in scope for the factory. graceful-fs is imported
// with an ESM default import so the test observes the same mocked instance
// that `../out/fs` consumes via `require('graceful-fs').default`.
import gracefulFS from 'graceful-fs';

const { pendingReads } = vi.hoisted(() => ({ pendingReads: [] }));

vi.mock('graceful-fs', async () => {
  const original = await vi.importActual('graceful-fs');
  const base = original.default || original;
  const mocked = {
    ...base,
    promises: {
      ...base.promises,
      readFile: vi.fn(
        () =>
          new Promise((resolve) => {
            pendingReads.push(() => resolve(Buffer.from('content')));
          }),
      ),
    },
  };
  // Expose both the namespace (for `require('graceful-fs')`) and a matching
  // `default` (for ESM default import and the compiled `__importDefault`).
  return { ...mocked, default: mocked };
});

const { CachedFileSystem } = require('../out/fs');

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe('CachedFileSystem concurrency limit', () => {
  beforeEach(() => {
    pendingReads.length = 0;
    gracefulFS.promises.readFile.mockClear();
  });

  it('serializes file IO when fileIOConcurrency is 1', async () => {
    const fileSystem = new CachedFileSystem({ fileIOConcurrency: 1 });

    const a = fileSystem.readFile('/a.txt');
    const b = fileSystem.readFile('/b.txt');

    await flushMicrotasks();
    await flushMicrotasks();

    expect(gracefulFS.promises.readFile).toHaveBeenCalledTimes(1);

    pendingReads[0]();
    await a;
    await flushMicrotasks();

    expect(gracefulFS.promises.readFile).toHaveBeenCalledTimes(2);

    pendingReads[1]();
    await b;
  });
});
