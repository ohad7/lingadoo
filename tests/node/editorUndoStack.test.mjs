import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { createUndoStack } = await import('../../src/lib/editorUndoStack.ts');

describe('editorUndoStack', () => {
  it('starts empty with nothing to undo or redo', () => {
    const stack = createUndoStack();
    assert.equal(stack.canUndo(), false);
    assert.equal(stack.canRedo(), false);
  });

  it('can undo after push', () => {
    const stack = createUndoStack();
    const state1 = { pageId: 1, blocks: [{ id: 'a', text: 'hello' }], graphicRegions: [] };
    stack.push(state1);
    assert.equal(stack.canUndo(), true);
    assert.equal(stack.canRedo(), false);
  });

  it('undo returns the previous state', () => {
    const stack = createUndoStack();
    const state1 = { pageId: 1, blocks: [{ id: 'a', text: 'hello' }], graphicRegions: [] };
    const state2 = { pageId: 1, blocks: [{ id: 'a', text: 'world' }], graphicRegions: [] };
    stack.push(state1);
    stack.push(state2);
    const restored = stack.undo();
    assert.deepEqual(restored, state2);
  });

  it('redo returns the undone state', () => {
    const stack = createUndoStack();
    const before = { pageId: 1, blocks: [{ id: 'a', text: 'v1' }], graphicRegions: [] };
    const after = { pageId: 1, blocks: [{ id: 'a', text: 'v2' }], graphicRegions: [] };
    stack.push(before);
    stack.push(after);
    stack.undo();
    assert.equal(stack.canRedo(), true);
  });

  it('push clears redo stack', () => {
    const stack = createUndoStack();
    stack.push({ pageId: 1, blocks: [], graphicRegions: [] });
    stack.push({ pageId: 1, blocks: [{ id: 'b' }], graphicRegions: [] });
    stack.undo();
    assert.equal(stack.canRedo(), true);
    stack.push({ pageId: 1, blocks: [{ id: 'c' }], graphicRegions: [] });
    assert.equal(stack.canRedo(), false);
  });

  it('respects max size limit', () => {
    const stack = createUndoStack(3);
    for (let i = 0; i < 5; i++) {
      stack.push({ pageId: 1, blocks: [{ id: String(i) }], graphicRegions: [] });
    }
    let undoCount = 0;
    while (stack.canUndo()) { stack.undo(); undoCount++; }
    assert.equal(undoCount, 3);
  });

  it('undo/redo return null when empty', () => {
    const stack = createUndoStack();
    assert.equal(stack.undo(), null);
    assert.equal(stack.redo(), null);
  });
});
