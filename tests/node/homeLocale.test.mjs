import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appModeFromPath,
  appPathFromLocationPath,
  localeFromPath,
  normalizeBasePath,
} from '../../src/lib/homeLocale.ts';

test('localeFromPath', async (t) => {
  await t.test('/ returns en', () => {
    assert.equal(localeFromPath('/'), 'en');
  });
  await t.test('/he returns he', () => {
    assert.equal(localeFromPath('/he'), 'he');
  });
  await t.test('/ar returns ar', () => {
    assert.equal(localeFromPath('/ar'), 'ar');
  });
  await t.test('/he/ with trailing slash returns he', () => {
    assert.equal(localeFromPath('/he/'), 'he');
  });
  await t.test('/unknown returns en', () => {
    assert.equal(localeFromPath('/unknown'), 'en');
  });
  await t.test('/edit returns en (edit with no locale)', () => {
    assert.equal(localeFromPath('/edit'), 'en');
  });
  await t.test('/edit/he returns he', () => {
    assert.equal(localeFromPath('/edit/he'), 'he');
  });
  await t.test('/edit/ar returns ar', () => {
    assert.equal(localeFromPath('/edit/ar'), 'ar');
  });
  await t.test('/edit/ with trailing slash returns en', () => {
    assert.equal(localeFromPath('/edit/'), 'en');
  });
  await t.test('/edit/unknown returns en', () => {
    assert.equal(localeFromPath('/edit/unknown'), 'en');
  });
  await t.test('empty string returns en', () => {
    assert.equal(localeFromPath(''), 'en');
  });
});

test('appModeFromPath', async (t) => {
  await t.test('/ returns translate', () => {
    assert.equal(appModeFromPath('/'), 'translate');
  });
  await t.test('/he returns translate', () => {
    assert.equal(appModeFromPath('/he'), 'translate');
  });
  await t.test('/edit returns edit', () => {
    assert.equal(appModeFromPath('/edit'), 'edit');
  });
  await t.test('/edit/he returns edit', () => {
    assert.equal(appModeFromPath('/edit/he'), 'edit');
  });
  await t.test('/edit/ with trailing slash returns edit', () => {
    assert.equal(appModeFromPath('/edit/'), 'edit');
  });
  await t.test('/unknown returns translate', () => {
    assert.equal(appModeFromPath('/unknown'), 'translate');
  });
  await t.test('empty string returns translate', () => {
    assert.equal(appModeFromPath(''), 'translate');
  });
});

test('normalizeBasePath', async (t) => {
  await t.test('defaults to root for empty or root values', () => {
    assert.equal(normalizeBasePath(''), '/');
    assert.equal(normalizeBasePath('/'), '/');
  });
  await t.test('adds leading and trailing slashes for repository base paths', () => {
    assert.equal(normalizeBasePath('notary'), '/notary/');
    assert.equal(normalizeBasePath('/notary'), '/notary/');
    assert.equal(normalizeBasePath('/notary/'), '/notary/');
  });
});

test('appPathFromLocationPath', async (t) => {
  await t.test('leaves root deployments unchanged', () => {
    assert.equal(appPathFromLocationPath('/he', '/'), '/he');
    assert.equal(appPathFromLocationPath('/edit/he', '/'), '/edit/he');
  });
  await t.test('strips the repository base path for GitHub Pages deployments', () => {
    assert.equal(appPathFromLocationPath('/notary', '/notary/'), '/');
    assert.equal(appPathFromLocationPath('/notary/', '/notary/'), '/');
    assert.equal(appPathFromLocationPath('/notary/he', '/notary/'), '/he');
    assert.equal(appPathFromLocationPath('/notary/edit/he', '/notary/'), '/edit/he');
  });
  await t.test('falls back to the original path when the base path does not match', () => {
    assert.equal(appPathFromLocationPath('/he', '/notary/'), '/he');
  });
});
