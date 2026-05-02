import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferTextDirection,
  resolveEffectiveAlignment,
  resolveMirroredAlignment,
} from '../../src/lib/textAlignmentPolicy.js';

test('resolveEffectiveAlignment preserves justify for non-tight text', () => {
  assert.equal(resolveEffectiveAlignment({
    alignment: 'justify',
    text: 'hello world',
  }), 'justify');
});

test('resolveEffectiveAlignment honors manual alignment overrides for tight text', () => {
  assert.equal(resolveEffectiveAlignment({
    alignment: 'center',
    alignmentEdited: true,
    text: 'שלום',
    textTightness: 'tight',
  }), 'center');
});

test('resolveEffectiveAlignment still uses directional start alignment for untouched tight text', () => {
  assert.equal(resolveEffectiveAlignment({
    alignment: 'center',
    alignmentEdited: false,
    text: 'hello',
    textTightness: 'tight',
  }), 'left');
});

test('resolveMirroredAlignment preserves justify across mirroring', () => {
  assert.equal(resolveMirroredAlignment({
    sourceAlignment: 'justify',
    translatedText: 'hello world',
    mirrorEnabled: true,
  }), 'justify');
});

test('inferTextDirection prefers the dominant strong script and ignores digits', () => {
  assert.equal(inferTextDirection('אינטרנט 600/100 מגה Bfiber'), 'rtl');
  assert.equal(inferTextDirection('Bfiber mega 600/100 internet'), 'ltr');
});
