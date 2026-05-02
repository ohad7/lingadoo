import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { computeDragSelection } = await import('../../src/lib/editorSelection.ts');

describe('computeDragSelection', () => {
  it('preserves all selected blocks when dragging one of them (no modifier)', () => {
    const pageIndex = new Map([['a', 1], ['b', 1], ['c', 1]]);
    const result = computeDragSelection(['a', 'b', 'c'], 'b', false, 1, pageIndex);
    assert.deepEqual(result, ['a', 'b', 'c']);
  });

  it('keeps single selection when dragging the same block (no modifier)', () => {
    const pageIndex = new Map([['a', 1]]);
    const result = computeDragSelection(['a'], 'a', false, 1, pageIndex);
    assert.deepEqual(result, ['a']);
  });

  it('resets to dragged block when dragging an unselected block (no modifier)', () => {
    const pageIndex = new Map([['a', 1], ['b', 1], ['z', 1]]);
    const result = computeDragSelection(['a', 'b'], 'z', false, 1, pageIndex);
    assert.deepEqual(result, ['z']);
  });

  it('adds block to selection with multi modifier', () => {
    const pageIndex = new Map([['a', 1], ['b', 1]]);
    const result = computeDragSelection(['a'], 'b', true, 1, pageIndex);
    assert.deepEqual(result, ['a', 'b']);
  });

  it('removes block from selection with multi modifier', () => {
    const pageIndex = new Map([['a', 1], ['b', 1]]);
    const result = computeDragSelection(['a', 'b'], 'b', true, 1, pageIndex);
    assert.deepEqual(result, ['a']);
  });

  it('resets selection when multi-selecting across pages', () => {
    const pageIndex = new Map([['a', 1], ['b', 2]]);
    const result = computeDragSelection(['a'], 'b', true, 2, pageIndex);
    assert.deepEqual(result, ['b']);
  });

  it('falls back to dragged block when selection would be empty', () => {
    const pageIndex = new Map([['a', 1]]);
    const result = computeDragSelection(['a'], 'a', true, 1, pageIndex);
    assert.deepEqual(result, ['a']);
  });
});
