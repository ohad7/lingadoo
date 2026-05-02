/**
 * Computes the next block selection state when a drag begins on a block.
 *
 * @param selectedBlockIds - currently selected block IDs
 * @param blockId - the block being dragged
 * @param multi - whether a multi-select modifier (Shift/Cmd/Ctrl) is held
 * @param blockPageId - page ID of the block being dragged
 * @param pageIndex - map from block ID to page ID
 */
export function computeDragSelection(
  selectedBlockIds: string[],
  blockId: string,
  multi: boolean,
  blockPageId: number,
  pageIndex: Map<string, number>,
): string[] {
  let nextSelection = [...selectedBlockIds];

  if (multi) {
    const selectedOnOtherPage = selectedBlockIds.some((selectedId) => {
      const selectedPageId = pageIndex.get(selectedId);
      return selectedPageId != null && selectedPageId !== blockPageId;
    });
    if (selectedOnOtherPage) {
      nextSelection = [blockId];
    } else if (selectedBlockIds.includes(blockId)) {
      nextSelection = selectedBlockIds.filter((item) => item !== blockId);
    } else {
      nextSelection = [...selectedBlockIds, blockId];
    }
  } else if (!selectedBlockIds.includes(blockId)) {
    nextSelection = [blockId];
  }

  if (!nextSelection.length) {
    nextSelection = [blockId];
  }

  return nextSelection;
}
