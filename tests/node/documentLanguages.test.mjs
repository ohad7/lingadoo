import assert from 'node:assert/strict';
import test from 'node:test';

import { containsSourceScript } from '../../src/lib/pdf-core/documentLanguages.js';

test('containsSourceScript stays stable across successive Hebrew block checks', () => {
  const sequence = [
    ['לפרטים ומידע נוסף 5054', true],
    ['*', false],
    ['הברזל', true],
    ["19 א', רמת החייל, תל-אביב 6971026", true],
    ['פקס: 073-2462700', true],
    ['www.as-invest.co.il', false],
  ];
  const results = sequence.map(([text]) => containsSourceScript(text, 'he'));
  assert.deepEqual(results, sequence.map(([, expected]) => expected));
});

test('containsSourceScript stays stable across successive Arabic block checks', () => {
  const sequence = [
    ['مرحبا', true],
    ['12345', false],
    ['العربية', true],
    ['fax: 073-2462700', false],
  ];
  const results = sequence.map(([text]) => containsSourceScript(text, 'ar'));
  assert.deepEqual(results, sequence.map(([, expected]) => expected));
});

test('containsSourceScript stays stable across successive Latin block checks', () => {
  const sequence = [
    ['Employer Name', true],
    ['5555555', false],
    ['General Employee', true],
    ['שלום', false],
  ];
  const results = sequence.map(([text]) => containsSourceScript(text, 'en'));
  assert.deepEqual(results, sequence.map(([, expected]) => expected));
});
