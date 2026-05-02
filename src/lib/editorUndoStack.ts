export type UndoEntry = {
  pageId: number;
  blocks: unknown[];
  graphicRegions: unknown[];
};

export type UndoStack = {
  push: (entry: UndoEntry) => void;
  undo: () => UndoEntry | null;
  redo: () => UndoEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
};

export function createUndoStack(maxSize = 50): UndoStack {
  const past: UndoEntry[] = [];
  const future: UndoEntry[] = [];

  return {
    push(entry) {
      past.push(structuredClone(entry));
      future.length = 0;
      if (past.length > maxSize) {
        past.shift();
      }
    },
    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return entry;
    },
    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push(entry);
      return entry;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}
