import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserTranslatorProvider,
  TranslationDependencyError,
} from '../../src/lib/pdf-core/translation.js';

test('checkAvailability returns available when model is cached', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => 'available',
      create: async () => ({ translate: async (t) => `en:${t}`, destroy() {} }),
    },
  });
  assert.equal(await provider.checkAvailability(), 'available');
});

test('checkAvailability returns downloadable when model needs download', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => ({ translate: async (t) => `en:${t}`, destroy() {} }),
    },
  });
  assert.equal(await provider.checkAvailability(), 'downloadable');
});

test('checkAvailability returns downloading when model is being downloaded', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => 'downloading',
      create: async () => ({ translate: async (t) => `en:${t}`, destroy() {} }),
    },
  });
  assert.equal(await provider.checkAvailability(), 'downloading');
});

test('checkAvailability returns unavailable when API is not present', async () => {
  const provider = new BrowserTranslatorProvider({ TranslatorImpl: null });
  assert.equal(await provider.checkAvailability(), 'unavailable');
});

test('checkAvailability returns unavailable on timeout', async () => {
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 10,
    TranslatorImpl: {
      availability: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'available';
      },
      create: async () => ({ translate: async (t) => t, destroy() {} }),
    },
  });
  assert.equal(await provider.checkAvailability(), 'unavailable');
});

test('setCreateTimeout allows slow create to succeed', async () => {
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 50,
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { translate: async (t) => `translated:${t}`, destroy() {} };
      },
    },
  });
  provider.setCreateTimeout(5000);
  const result = await provider.translate('שלום');
  assert.equal(result, 'translated:שלום');
});

test('create times out at default when setCreateTimeout not called', async () => {
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 30,
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { translate: async (t) => `translated:${t}`, destroy() {} };
      },
    },
  });
  await assert.rejects(provider.translate('test'), /timed out/);
});

test('ensureReady eagerly triggers create and blocks until ready', async () => {
  let createStarted = false;
  let createFinished = false;
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 50,
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => {
        createStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 80));
        createFinished = true;
        return { translate: async (t) => `translated:${t}`, destroy() {} };
      },
    },
  });
  provider.setCreateTimeout(5000);
  assert.equal(createStarted, false);
  await provider.ensureReady();
  assert.equal(createStarted, true);
  assert.equal(createFinished, true);
  // Subsequent translate should work immediately (no second create)
  const result = await provider.translate('שלום');
  assert.equal(result, 'translated:שלום');
});

test('translate propagates error when create fails (no silent passthrough)', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => 'available',
      create: async () => { throw new Error('network error during model download'); },
    },
  });
  await assert.rejects(provider.translate('test'), /network error/);
});

test('destroy is safe after failed checkAvailability', async () => {
  const provider = new BrowserTranslatorProvider({ TranslatorImpl: null });
  assert.equal(await provider.checkAvailability(), 'unavailable');
  await assert.doesNotReject(provider.destroy());
});
