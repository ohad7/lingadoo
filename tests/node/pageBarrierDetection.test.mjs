import assert from 'node:assert/strict';
import test from 'node:test';

import { detectHorizontalBarriersFromGray } from '../../src/lib/pageBarrierDetection.ts';

function makeGray(width, height, fill = 255) {
  const gray = new Float32Array(width * height);
  gray.fill(fill);
  return gray;
}

function fillRect(gray, width, [x0, y0, x1, y1], value) {
  for (let y = y0; y < y1; y += 1) {
    const rowOffset = y * width;
    for (let x = x0; x < x1; x += 1) {
      gray[rowOffset + x] = value;
    }
  }
}

test('detectHorizontalBarriersFromGray finds explicit line and strong edge barriers', () => {
  const width = 60;
  const height = 80;
  const gray = makeGray(width, height);

  fillRect(gray, width, [10, 8, 12, 72], 0);
  fillRect(gray, width, [30, 12, 42, 70], 150);

  const barriers = detectHorizontalBarriersFromGray({
    gray,
    width,
    height,
    pageWidthPt: width,
    pageHeightPt: height,
  });

  assert.ok(
    barriers.some((barrier) => Math.abs(barrier.x - 11) <= 2 && barrier.kind !== 'vertical_edge'),
    'should detect the explicit vertical rule',
  );
  assert.ok(
    barriers.some((barrier) => Math.abs(barrier.x - 30) <= 2 || Math.abs(barrier.x - 42) <= 2),
    'should detect at least one strong vertical panel edge',
  );
});

test('detectHorizontalBarriersFromGray respects excluded regions', () => {
  const width = 50;
  const height = 70;
  const gray = makeGray(width, height);

  fillRect(gray, width, [20, 6, 22, 64], 0);

  const withoutExclusion = detectHorizontalBarriersFromGray({
    gray,
    width,
    height,
    pageWidthPt: width,
    pageHeightPt: height,
  });
  const withExclusion = detectHorizontalBarriersFromGray({
    gray,
    width,
    height,
    pageWidthPt: width,
    pageHeightPt: height,
    excludeBboxesPt: [[18, 0, 26, height]],
  });

  assert.ok(withoutExclusion.some((barrier) => Math.abs(barrier.x - 21) <= 2));
  assert.equal(withExclusion.some((barrier) => Math.abs(barrier.x - 21) <= 2), false);
});

test('detectHorizontalBarriersFromGray keeps lighter broken vertical rules', () => {
  const width = 70;
  const height = 100;
  const gray = makeGray(width, height);

  for (let y = 10; y < 88; y += 1) {
    if ((y % 9) === 0 || (y % 9) === 1) {
      continue;
    }
    fillRect(gray, width, [34, y, 35, y + 1], 226);
  }

  const barriers = detectHorizontalBarriersFromGray({
    gray,
    width,
    height,
    pageWidthPt: width,
    pageHeightPt: height,
  });

  assert.ok(
    barriers.some((barrier) => Math.abs(barrier.x - 34.5) <= 2),
    'should detect a light vertical rule even when it has short gaps',
  );
});

test('detectHorizontalBarriersFromGray rejects columns inside a wide dark background region', () => {
  const width = 80;
  const height = 100;
  const gray = makeGray(width, height);

  // Paint a wide dark background block (20px wide) — not a line
  fillRect(gray, width, [30, 10, 50, 90], 100);

  const barriers = detectHorizontalBarriersFromGray({
    gray,
    width,
    height,
    pageWidthPt: width,
    pageHeightPt: height,
  });

  const interiorBarriers = barriers.filter(
    (b) => b.kind === 'explicit_line' && b.x >= 33 && b.x <= 47,
  );
  assert.equal(
    interiorBarriers.length,
    0,
    'should not detect explicit line barriers inside a wide dark region',
  );
});
