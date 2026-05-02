import { strictEqual, deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { extractDocTextColors, extractDocBgColors, hexToRgb01 } from '../../src/lib/colorUtils.ts';

test('extractDocTextColors deduplicates exact colors', () => {
  const pages = [
    { blocks: [{ text_color: '#ff0000' }, { text_color: '#ff0000' }, { text_color: '#00ff00' }] },
    { blocks: [{ text_color: '#0000ff' }, {}] },
  ];
  const result = extractDocTextColors(pages);
  deepStrictEqual(result, ['#ff0000', '#00ff00', '#0000ff']);
});

test('extractDocTextColors caps at 6 colors', () => {
  // 7 perceptually distinct colors
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'];
  const blocks = colors.map((c) => ({ text_color: c }));
  const result = extractDocTextColors([{ blocks }]);
  strictEqual(result.length, 6);
});

test('extractDocTextColors normalizes to lowercase', () => {
  const pages = [{ blocks: [{ text_color: '#FF0000' }] }];
  const result = extractDocTextColors(pages);
  deepStrictEqual(result, ['#ff0000']);
});

test('extractDocTextColors skips missing text_color', () => {
  const pages = [{ blocks: [{}, { text_color: null }, { text_color: '#abcdef' }] }];
  const result = extractDocTextColors(pages);
  deepStrictEqual(result, ['#abcdef']);
});

test('extractDocTextColors merges perceptually similar colors', () => {
  // #122333 and #132434 are very close dark blues — should collapse to one
  const pages = [{ blocks: [
    { text_color: '#122333' },
    { text_color: '#132434' },
    { text_color: '#ff0000' },
  ]}];
  const result = extractDocTextColors(pages);
  strictEqual(result.length, 2);
});

test('extractDocTextColors returns most frequent color first', () => {
  // #0000ff appears 5 times, #ff0000 appears once — #0000ff should come first
  const pages = [{ blocks: [
    { text_color: '#ff0000' },
    { text_color: '#0000ff' },
    { text_color: '#0000ff' },
    { text_color: '#0000ff' },
    { text_color: '#0000ff' },
    { text_color: '#0000ff' },
  ]}];
  const result = extractDocTextColors(pages);
  deepStrictEqual(result, ['#0000ff', '#ff0000']);
});

test('extractDocBgColors deduplicates exact colors', () => {
  const pages = [
    { blocks: [
      { background_fill_color: [1, 1, 1] },
      { background_fill_color: [1, 1, 1] },
      { background_fill_color: [0.5, 0.5, 0.5] },
    ]},
  ];
  const result = extractDocBgColors(pages);
  strictEqual(result.length, 2);
});

test('extractDocBgColors caps at 6', () => {
  // 7 perceptually distinct colors
  const blocks = [
    [1,0,0],[0,1,0],[0,0,1],[0.5,0,0],[0,0.5,0],[0,0,0.5],[0.2,0.2,0.2]
  ].map((c) => ({ background_fill_color: c }));
  const result = extractDocBgColors([{ blocks }]);
  strictEqual(result.length, 6);
});

test('extractDocBgColors skips non-array values', () => {
  const pages = [{ blocks: [{}, { background_fill_color: null }, { background_fill_color: [0.9, 0.8, 0.7] }] }];
  const result = extractDocBgColors(pages);
  strictEqual(result.length, 1);
});

test('extractDocBgColors merges perceptually similar colors', () => {
  // Very close whites should collapse to one
  const pages = [{ blocks: [
    { background_fill_color: [1, 1, 1] },
    { background_fill_color: [0.97, 0.97, 0.97] },
    { background_fill_color: [0, 0, 1] },
  ]}];
  const result = extractDocBgColors(pages);
  strictEqual(result.length, 2);
});

test('extractDocBgColors returns most frequent color first', () => {
  // [0,0,1] appears 3 times, [1,1,1] once — blue should come first
  const pages = [{ blocks: [
    { background_fill_color: [1, 1, 1] },
    { background_fill_color: [0, 0, 1] },
    { background_fill_color: [0, 0, 1] },
    { background_fill_color: [0, 0, 1] },
  ]}];
  const result = extractDocBgColors(pages);
  deepStrictEqual(result[0], [0, 0, 1]);
});

test('hexToRgb01 converts hex to 0-1 float array', () => {
  const [r, g, b] = hexToRgb01('#ff8000');
  strictEqual(Math.round(r * 255), 255);
  strictEqual(Math.round(g * 255), 128);
  strictEqual(Math.round(b * 255), 0);
});

test('hexToRgb01 returns black for invalid hex', () => {
  deepStrictEqual(hexToRgb01('#fff'), [0, 0, 0]);
  deepStrictEqual(hexToRgb01(''), [0, 0, 0]);
});
