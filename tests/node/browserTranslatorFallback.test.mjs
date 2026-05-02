import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserTranslatorProvider, TranslationDependencyError } from '../../src/lib/pdf-core/translation.js';

test('checkAvailability returns the raw availability string', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => ({ translate: async (t) => t, destroy() {} }),
    },
  });
  const result = await provider.checkAvailability();
  assert.equal(result, 'downloadable');
});

test('checkAvailability returns unavailable when API is not supported', async () => {
  const provider = new BrowserTranslatorProvider({ TranslatorImpl: null });
  const result = await provider.checkAvailability();
  assert.equal(result, 'unavailable');
});

test('BrowserTranslatorProvider.destroy swallows rejected initialization state', async () => {
  const provider = new BrowserTranslatorProvider({
    TranslatorImpl: {
      availability: async () => { throw new TranslationDependencyError('availability failed'); },
      create: async () => ({ destroy() {} }),
    },
  });

  await assert.rejects(
    provider.translate('שלום'),
    /availability failed/,
  );

  await assert.doesNotReject(provider.destroy());
});

test('setCreateTimeout uses longer timeout for create call', async () => {
  let createCalled = false;
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 50,
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => {
        createCalled = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { translate: async (t) => `translated: ${t}`, destroy() {} };
      },
    },
  });
  provider.setCreateTimeout(5000);
  const result = await provider.translate('שלום');
  assert.ok(createCalled);
  assert.equal(result, 'translated: שלום');
});

test('translate times out with short default timeout when create is slow', async () => {
  const provider = new BrowserTranslatorProvider({
    timeoutMs: 50,
    TranslatorImpl: {
      availability: async () => 'downloadable',
      create: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { translate: async (t) => `translated: ${t}`, destroy() {} };
      },
    },
  });
  await assert.rejects(provider.translate('שלום'), /timed out/);
});
