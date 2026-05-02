import assert from 'node:assert/strict';
import test from 'node:test';

import { blockInCell, detectTableCells } from '../../src/lib/tableCellDetector.js';

function hBarrier(x, y1, y2) {
  return { barrier_id: `h_${x}_${y1}_${y2}`, x, y1, y2, score: 0.8, kind: 'explicit_line' };
}

function vBarrier(y, x1, x2) {
  return { barrier_id: `v_${y}_${x1}_${x2}`, y, x1, x2, score: 0.8, kind: 'explicit_line' };
}

test('detectTableCells finds a 4-wall cell', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(200, 50, 150)],
    [vBarrier(50, 100, 200), vBarrier(150, 100, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 1);
  assert.deepEqual(cells[0], {
    cellId: 'cell_0',
    x1: 100,
    y1: 50,
    x2: 200,
    y2: 150,
    walls: 4,
    wallDetails: { left: true, right: true, top: true, bottom: true },
  });
});

test('detectTableCells finds a 3-wall cell that uses the left page edge', () => {
  const cells = detectTableCells(
    [hBarrier(200, 50, 150)],
    [vBarrier(50, 0, 200), vBarrier(150, 0, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 1);
  assert.equal(cells[0].walls, 3);
  assert.deepEqual(cells[0].wallDetails, { left: false, right: true, top: true, bottom: true });
  assert.deepEqual([cells[0].x1, cells[0].y1, cells[0].x2, cells[0].y2], [0, 50, 200, 150]);
});

test('detectTableCells does not use a synthetic page edge when barriers do not reach it', () => {
  const cells = detectTableCells(
    [hBarrier(200, 50, 150)],
    [vBarrier(50, 50, 200), vBarrier(150, 50, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 0);
});

test('detectTableCells ignores non-intersecting barriers', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 100), hBarrier(200, 50, 100)],
    [vBarrier(50, 100, 200), vBarrier(200, 100, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 0);
});

test('detectTableCells applies the corner tolerance', () => {
  const accepted = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(200, 50, 150)],
    [vBarrier(50, 111, 200), vBarrier(150, 111, 200)],
    500,
    500,
  );
  const rejected = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(200, 50, 150)],
    [vBarrier(50, 114, 200), vBarrier(150, 114, 200)],
    500,
    500,
  );

  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
});

test('detectTableCells accepts wide short cells when the area is still modest', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 100), hBarrier(450, 50, 100)],
    [vBarrier(50, 100, 450), vBarrier(100, 100, 450)],
    600,
    600,
  );

  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].x1, cells[0].y1, cells[0].x2, cells[0].y2], [100, 50, 450, 100]);
});

test('detectTableCells rejects oversized cells', () => {
  const cells = detectTableCells(
    [hBarrier(20, 40, 140), hBarrier(320, 40, 140)],
    [vBarrier(40, 20, 320), vBarrier(140, 20, 320)],
    400,
    400,
  );

  assert.equal(cells.length, 0);
});

test('detectTableCells rejects tiny cells', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(108, 50, 150)],
    [vBarrier(50, 100, 108), vBarrier(150, 100, 108)],
    500,
    500,
  );

  assert.equal(cells.length, 0);
});

test('detectTableCells keeps adjacent cells and drops same-span container cells', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(200, 50, 150), hBarrier(300, 50, 150)],
    [vBarrier(50, 100, 300), vBarrier(150, 100, 300)],
    700,
    500,
  );

  assert.equal(cells.length, 2);
  assert.deepEqual(
    cells.map((cell) => [cell.x1, cell.y1, cell.x2, cell.y2]),
    [
      [100, 50, 200, 150],
      [200, 50, 300, 150],
    ],
  );
});

test('detectTableCells keeps a row cell when a narrow adjacent sliver only touches within corner tolerance', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(200, 50, 150), hBarrier(210, 50, 150)],
    [vBarrier(50, 100, 210), vBarrier(150, 100, 210)],
    500,
    500,
  );

  assert.deepEqual(
    cells.map((cell) => [cell.x1, cell.y1, cell.x2, cell.y2]),
    [
      [200, 50, 210, 150],
      [100, 50, 200, 150],
    ],
  );
});

test('detectTableCells rejects candidates that rely on two synthetic page edges', () => {
  const cells = detectTableCells(
    [hBarrier(100, 0, 100)],
    [vBarrier(100, 0, 100)],
    500,
    500,
  );

  assert.equal(cells.length, 0);
});

test('detectTableCells dedupes near-duplicate cells', () => {
  const cells = detectTableCells(
    [hBarrier(100, 50, 150), hBarrier(102, 50, 150), hBarrier(200, 50, 150)],
    [vBarrier(50, 100, 200), vBarrier(150, 100, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].x1, cells[0].y1, cells[0].x2, cells[0].y2], [102, 50, 200, 150]);
});

test('detectTableCells sorts barriers before enumeration', () => {
  const cells = detectTableCells(
    [hBarrier(200, 50, 150), hBarrier(100, 50, 150)],
    [vBarrier(150, 100, 200), vBarrier(50, 100, 200)],
    500,
    500,
  );

  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].x1, cells[0].y1, cells[0].x2, cells[0].y2], [100, 50, 200, 150]);
});

test('detectTableCells accepts imperfect boxes when corner gaps stay within tolerance', () => {
  const cells = detectTableCells(
    [
      hBarrier(100, 50, 139),
      hBarrier(200, 50, 150),
    ],
    [
      vBarrier(50, 110, 200),
      vBarrier(150, 110, 200),
    ],
    500,
    500,
  );

  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].x1, cells[0].y1, cells[0].x2, cells[0].y2], [100, 50, 200, 150]);
});

test('blockInCell checks the bbox center', () => {
  const cell = {
    cellId: 'cell_0',
    x1: 100,
    y1: 50,
    x2: 200,
    y2: 150,
    walls: 4,
    wallDetails: { left: true, right: true, top: true, bottom: true },
  };

  assert.equal(blockInCell([110, 60, 130, 80], cell), true);
  assert.equal(blockInCell([50, 60, 90, 80], cell), false);
});
