import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectContinuationGroups,
  projectContinuationBarriers,
} from '../../src/lib/sentenceContinuationDetector.js';

function block(id, bbox, sourceText, opts = {}) {
  return {
    source_block_id: id,
    bbox,
    source_text: sourceText,
    font_size: opts.font_size ?? 10,
    font_family: opts.font_family ?? 'Arial',
    block_type: opts.block_type ?? 'text_line',
  };
}

test('blocks ending without punctuation merge with next block below', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 22, 200, 32], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'b']);
});

test('blocks ending with period do not merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'המשפט הסתיים.'),
    block('b', [100, 22, 200, 32], 'משפט חדש מתחיל'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('three blocks chain together into one group', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 22, 200, 32], 'כל אחת מהקרנות שהוזכרו של'),
    block('c', [100, 34, 200, 44], 'מהקרנות הקיימות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'b', 'c']);
});

test('table cells are skipped', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין', { block_type: 'table_cell' }),
    block('b', [100, 22, 200, 32], 'כל אחת מהקרנות', { block_type: 'table_cell' }),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('blocks too far apart vertically do not merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 80, 200, 90], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('different font sizes prevent merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין', { font_size: 10 }),
    block('b', [100, 22, 200, 32], 'כל אחת מהקרנות', { font_size: 30 }),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('B starting with bullet/number prevents merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 22, 200, 32], '1. כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('unmatched open paren in A triggers merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'הנתונים (כולל'),
    block('b', [100, 22, 200, 32], 'מקיפה וכללית) מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'b']);
});

test('group bbox is union of member bboxes with 2pt padding', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('b', [90, 22, 210, 32], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].bbox, [88, 8, 212, 34]);
});

test('horizontal adjacency: same row blocks merge when A is long and B is short', () => {
  // RTL: higher x first, so b (x=155) is sorted before a (x=100)
  // b ends with dangling preposition "בגין" which triggers merge with a
  const blocks = [
    block('a', [100, 10, 150, 20], 'כל אחת'),
    block('b', [155, 10, 200, 20], 'נתונים בגין'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds.sort(), ['a', 'b']);
});

test('same-row short blocks do not merge (column headers)', () => {
  const blocks = [
    block('a', [100, 10, 150, 20], 'תגמולי עובד'),
    block('b', [160, 10, 210, 20], 'תגמולי מעסיק'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('barrier block between candidates prevents merge via horizontal overlap', () => {
  // In the greedy chain, a intervening block that ends with punctuation breaks
  // the chain between a and c. The barrier (ending with period) prevents a from
  // chaining through to c, even though a ends with a dangling preposition.
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('barrier', [120, 22, 180, 32], 'טקסט חוסם.'),
    block('c', [100, 34, 200, 44], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.ok(!groups.some((g) => g.blockIds.includes('a') && g.blockIds.includes('c')),
    'a and c should not be in the same group because barrier breaks the chain');
});

test('block ending with single Hebrew prefix letter merges with next block', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'הנתונים ב'),
    block('b', [100, 22, 200, 32], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'b']);
});

test('two long blocks with no positive signal do not merge', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'אבל הנתונים שלנו מראים תמונה שונה לגמרי'),
    block('b', [100, 22, 200, 32], 'המגמות האלה נמשכות כבר שנים רבות מאוד'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('visual vertical barrier between blocks prevents merge', () => {
  // Two blocks side by side (same row), but a detected vertical barrier line between them
  const blocks = [
    block('a', [200, 10, 300, 22], 'נתונים בגין'),
    block('b', [100, 10, 195, 22], 'כל אחת'),
  ];
  const horizontalBarriers = [{ x: 198, y1: 5, y2: 30 }]; // vertical line between the two blocks (horizontal barrier)
  const groups = detectContinuationGroups(blocks, { horizontalBarriers });
  assert.equal(groups.length, 0);
});

test('visual vertical barrier touching a block edge prevents merge', () => {
  const blocks = [
    block('a', [200, 10, 300, 22], 'נתונים בגין'),
    block('b', [100, 10, 195, 22], 'כל אחת'),
  ];
  const horizontalBarriers = [{ x: 195, y1: 5, y2: 30 }];
  const groups = detectContinuationGroups(blocks, { horizontalBarriers });
  assert.equal(groups.length, 0);
});

test('visual barrier outside block span does not prevent merge', () => {
  const blocks = [
    block('a', [200, 10, 300, 22], 'נתונים בגין'),
    block('b', [100, 10, 195, 22], 'כל אחת'),
  ];
  const horizontalBarriers = [{ x: 50, y1: 5, y2: 30 }]; // barrier far to the left, not between blocks
  const groups = detectContinuationGroups(blocks, { horizontalBarriers });
  assert.equal(groups.length, 1);
});

test('numeric-only block does not merge with Hebrew block', () => {
  // Reproduces b49 ("דמי ניהול שנגבו בשנה זו") + b56 ("111,111") false merge
  const blocks = [
    block('a', [100, 10, 200, 20], 'דמי ניהול שנגבו בשנה זו'),
    block('b', [200, 22, 260, 32], '111,111'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('date-only block does not merge with Hebrew block', () => {
  const blocks = [
    block('a', [100, 10, 200, 20], 'דמי ניהול שנגבו בשנה זו'),
    block('b', [100, 22, 200, 32], '30/09/2025'),
  ];
  const groups = detectContinuationGroups(blocks);
  assert.equal(groups.length, 0);
});

test('vertical barrier between vertically-stacked blocks prevents merge', () => {
  // Two blocks stacked vertically, with a horizontal line between them (vertical barrier)
  const blocks = [
    block('a', [100, 10, 300, 22], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 30, 300, 42], 'כל אחת מהקרנות'),
  ];
  const verticalBarriers = [{ y: 26, x1: 80, x2: 320 }]; // horizontal line between the two blocks
  const groups = detectContinuationGroups(blocks, { verticalBarriers });
  assert.equal(groups.length, 0);
});

test('vertical barrier touching a block edge prevents merge', () => {
  const blocks = [
    block('a', [100, 10, 300, 22], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 24, 300, 36], 'כל אחת מהקרנות'),
  ];
  const verticalBarriers = [{ y: 22, x1: 80, x2: 320 }];
  const groups = detectContinuationGroups(blocks, { verticalBarriers });
  assert.equal(groups.length, 0);
});

test('vertical barrier outside vertical gap does not prevent merge', () => {
  const blocks = [
    block('a', [100, 10, 300, 22], 'בחלק זה מובאים נתונים בגין'),
    block('b', [100, 24, 300, 36], 'כל אחת מהקרנות'),
  ];
  const verticalBarriers = [{ y: 50, x1: 80, x2: 320 }]; // barrier below both blocks
  const groups = detectContinuationGroups(blocks, { verticalBarriers });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'b']);
});

test('projectContinuationBarriers mirrors barrier coordinates for mirrored continuation detection', () => {
  const projected = projectContinuationBarriers({
    pageWidthPt: 595.28,
    mirrorEnabled: true,
    horizontalBarriers: [{ barrier_id: 'h1', x: 281.06, y1: 300.0, y2: 330.0 }],
    verticalBarriers: [{ barrier_id: 'v1', y: 316.5, x1: 281.06, x2: 493.17 }],
  });

  assert.equal(projected.horizontalBarriers.length, 1);
  assert.equal(projected.horizontalBarriers[0].barrier_id, 'h1');
  assert.ok(Math.abs(projected.horizontalBarriers[0].x - 314.22) < 0.001);
  assert.equal(projected.horizontalBarriers[0].y1, 300);
  assert.equal(projected.horizontalBarriers[0].y2, 330);

  assert.equal(projected.verticalBarriers.length, 1);
  assert.equal(projected.verticalBarriers[0].barrier_id, 'v1');
  assert.equal(projected.verticalBarriers[0].y, 316.5);
  assert.ok(Math.abs(projected.verticalBarriers[0].x1 - 102.11) < 0.001);
  assert.ok(Math.abs(projected.verticalBarriers[0].x2 - 314.22) < 0.001);
});

test('mirrored vertical barrier blocks continuation after projection into editor coordinates', () => {
  const blocks = [
    block('a', [105.89901635742183, 304.6199951171875, 259.29599999999994, 315.4768371582031], 'יתרת הכספים בחשבון בתחילת השנה'),
    block('b', [105.8989858398437, 317.2138671875, 230.7946401367187, 328.07073974609375], 'כספים שהופקדו לחשבון'),
  ];
  const projected = projectContinuationBarriers({
    pageWidthPt: 595.28,
    mirrorEnabled: true,
    verticalBarriers: [
      { y: 316.5, x1: 281.06, x2: 493.17 },
      { y: 316.5, x1: 281.58, x2: 334.22 },
    ],
  });

  const groups = detectContinuationGroups(blocks, {
    verticalBarriers: projected.verticalBarriers,
  });

  assert.equal(groups.length, 0);
});

test('block outside horizontal span does not act as barrier', () => {
  // A far-away block (not proximate) breaks the greedy chain between a and c.
  // The far block is placed far enough vertically to be non-proximate to both.
  const blocks = [
    block('a', [100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין'),
    block('far', [300, 60, 400, 70], '1. פריט רשימה'),
    block('c', [100, 22, 200, 32], 'כל אחת מהקרנות'),
  ];
  const groups = detectContinuationGroups(blocks);
  // sorted order: a (cy=15), c (cy=27), far (cy=65)
  // a->c: proximate, a has dangling preposition -> merge. [a, c]
  // c->far: not proximate (vGap = 60-32 = 28, maxH = 10, limit = 20) -> no merge.
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blockIds, ['a', 'c']);
});
