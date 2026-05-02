const CORNER_TOLERANCE_PT = 12;
const CONTAINMENT_TOLERANCE_PT = 2;
const MAX_AREA_RATIO = 0.15;
const MIN_DIMENSION_PT = 10;

function normalizeHorizontalWall(barrier) {
  const x = Number(barrier?.x);
  const y1 = Number(barrier?.y1);
  const y2 = Number(barrier?.y2);
  if (!Number.isFinite(x) || !Number.isFinite(y1) || !Number.isFinite(y2) || y2 <= y1) {
    return null;
  }
  return {
    barrier_id: String(barrier?.barrier_id || ''),
    x,
    y1,
    y2,
    synthetic: barrier?.synthetic === true,
  };
}

function normalizeVerticalWall(barrier) {
  const y = Number(barrier?.y);
  const x1 = Number(barrier?.x1);
  const x2 = Number(barrier?.x2);
  if (!Number.isFinite(y) || !Number.isFinite(x1) || !Number.isFinite(x2) || x2 <= x1) {
    return null;
  }
  return {
    barrier_id: String(barrier?.barrier_id || ''),
    y,
    x1,
    x2,
    synthetic: barrier?.synthetic === true,
  };
}

function buildCandidateHorizontalWalls(horizontalBarriers, pageWidthPt, pageHeightPt) {
  const pageWidth = Math.max(1, Number(pageWidthPt) || 1);
  const pageHeight = Math.max(1, Number(pageHeightPt) || 1);
  const walls = (horizontalBarriers || [])
    .map(normalizeHorizontalWall)
    .filter(Boolean);
  return [
    {
      barrier_id: '__page_left__',
      x: 0,
      y1: 0,
      y2: pageHeight,
      synthetic: true,
    },
    ...walls,
    {
      barrier_id: '__page_right__',
      x: pageWidth,
      y1: 0,
      y2: pageHeight,
      synthetic: true,
    },
  ].sort((left, right) => (
    Number(left.x) - Number(right.x)
    || Number(left.y1) - Number(right.y1)
    || String(left.barrier_id).localeCompare(String(right.barrier_id))
  ));
}

function buildCandidateVerticalWalls(verticalBarriers, pageWidthPt, pageHeightPt) {
  const pageWidth = Math.max(1, Number(pageWidthPt) || 1);
  const pageHeight = Math.max(1, Number(pageHeightPt) || 1);
  const walls = (verticalBarriers || [])
    .map(normalizeVerticalWall)
    .filter(Boolean);
  return [
    {
      barrier_id: '__page_top__',
      y: 0,
      x1: 0,
      x2: pageWidth,
      synthetic: true,
    },
    ...walls,
    {
      barrier_id: '__page_bottom__',
      y: pageHeight,
      x1: 0,
      x2: pageWidth,
      synthetic: true,
    },
  ].sort((left, right) => (
    Number(left.y) - Number(right.y)
    || Number(left.x1) - Number(right.x1)
    || String(left.barrier_id).localeCompare(String(right.barrier_id))
  ));
}

function buildCornerKey(horizontalWallId, verticalWallId) {
  return `${horizontalWallId}::${verticalWallId}`;
}

function hasCorner(horizontalWall, verticalWall) {
  return (
    horizontalWall.x >= (verticalWall.x1 - CORNER_TOLERANCE_PT)
    && horizontalWall.x <= (verticalWall.x2 + CORNER_TOLERANCE_PT)
    && verticalWall.y >= (horizontalWall.y1 - CORNER_TOLERANCE_PT)
    && verticalWall.y <= (horizontalWall.y2 + CORNER_TOLERANCE_PT)
  );
}

function cellArea(cell) {
  return Math.max(0, Number(cell.x2) - Number(cell.x1)) * Math.max(0, Number(cell.y2) - Number(cell.y1));
}

function cornersNearDuplicate(left, right) {
  return (
    Math.abs(Number(left.x1) - Number(right.x1)) <= CORNER_TOLERANCE_PT
    && Math.abs(Number(left.y1) - Number(right.y1)) <= CORNER_TOLERANCE_PT
    && Math.abs(Number(left.x2) - Number(right.x2)) <= CORNER_TOLERANCE_PT
    && Math.abs(Number(left.y2) - Number(right.y2)) <= CORNER_TOLERANCE_PT
  );
}

function containsCell(outer, inner) {
  return (
    Number(inner.x1) >= (Number(outer.x1) - CONTAINMENT_TOLERANCE_PT)
    && Number(inner.y1) >= (Number(outer.y1) - CONTAINMENT_TOLERANCE_PT)
    && Number(inner.x2) <= (Number(outer.x2) + CONTAINMENT_TOLERANCE_PT)
    && Number(inner.y2) <= (Number(outer.y2) + CONTAINMENT_TOLERANCE_PT)
  );
}

function sameHorizontalSpan(left, right) {
  return (
    Math.abs(Number(left.x1) - Number(right.x1)) <= CORNER_TOLERANCE_PT
    && Math.abs(Number(left.x2) - Number(right.x2)) <= CORNER_TOLERANCE_PT
  );
}

function sameVerticalSpan(left, right) {
  return (
    Math.abs(Number(left.y1) - Number(right.y1)) <= CORNER_TOLERANCE_PT
    && Math.abs(Number(left.y2) - Number(right.y2)) <= CORNER_TOLERANCE_PT
  );
}

function dedupeCells(cells) {
  const ordered = [...cells].sort((left, right) => (
    Number(right.walls) - Number(left.walls)
    || cellArea(left) - cellArea(right)
    || Number(left.x1) - Number(right.x1)
    || Number(left.y1) - Number(right.y1)
    || Number(left.x2) - Number(right.x2)
    || Number(left.y2) - Number(right.y2)
  ));
  const kept = [];
  for (const candidate of ordered) {
    const duplicate = kept.some((existing) => cornersNearDuplicate(existing, candidate));
    if (duplicate) {
      continue;
    }
    const sameSpanContainer = kept.some((existing) => (
      containsCell(candidate, existing)
      && (sameHorizontalSpan(candidate, existing) || sameVerticalSpan(candidate, existing))
    ));
    if (sameSpanContainer) {
      continue;
    }
    kept.push(candidate);
  }
  return kept.map((cell, index) => ({
    ...cell,
    cellId: `cell_${index}`,
  }));
}

export function detectTableCells(horizontalBarriers, verticalBarriers, pageWidthPt, pageHeightPt) {
  const pageWidth = Math.max(1, Number(pageWidthPt) || 1);
  const pageHeight = Math.max(1, Number(pageHeightPt) || 1);
  const candidateHorizontalWalls = buildCandidateHorizontalWalls(horizontalBarriers, pageWidth, pageHeight);
  const candidateVerticalWalls = buildCandidateVerticalWalls(verticalBarriers, pageWidth, pageHeight);
  const corners = new Set();

  for (const horizontalWall of candidateHorizontalWalls) {
    for (const verticalWall of candidateVerticalWalls) {
      if (hasCorner(horizontalWall, verticalWall)) {
        corners.add(buildCornerKey(horizontalWall.barrier_id, verticalWall.barrier_id));
      }
    }
  }

  const maxArea = pageWidth * pageHeight * MAX_AREA_RATIO;
  const detectedCells = [];
  for (let leftIndex = 0; leftIndex < candidateHorizontalWalls.length; leftIndex += 1) {
    const leftWall = candidateHorizontalWalls[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < candidateHorizontalWalls.length; rightIndex += 1) {
      const rightWall = candidateHorizontalWalls[rightIndex];
      if (leftWall.x >= rightWall.x) {
        continue;
      }
      for (let topIndex = 0; topIndex < candidateVerticalWalls.length; topIndex += 1) {
        const topWall = candidateVerticalWalls[topIndex];
        for (let bottomIndex = topIndex + 1; bottomIndex < candidateVerticalWalls.length; bottomIndex += 1) {
          const bottomWall = candidateVerticalWalls[bottomIndex];
          if (topWall.y >= bottomWall.y) {
            continue;
          }
          const requiredCorners = [
            buildCornerKey(leftWall.barrier_id, topWall.barrier_id),
            buildCornerKey(rightWall.barrier_id, topWall.barrier_id),
            buildCornerKey(leftWall.barrier_id, bottomWall.barrier_id),
            buildCornerKey(rightWall.barrier_id, bottomWall.barrier_id),
          ];
          if (requiredCorners.some((cornerKey) => !corners.has(cornerKey))) {
            continue;
          }
          const wallDetails = {
            left: leftWall.synthetic !== true,
            right: rightWall.synthetic !== true,
            top: topWall.synthetic !== true,
            bottom: bottomWall.synthetic !== true,
          };
          const walls = Object.values(wallDetails).filter(Boolean).length;
          const syntheticWallCount = 4 - walls;
          if (walls < 3 || syntheticWallCount > 1) {
            continue;
          }
          const width = rightWall.x - leftWall.x;
          const height = bottomWall.y - topWall.y;
          if (
            width < MIN_DIMENSION_PT
            || height < MIN_DIMENSION_PT
            || (width * height) > maxArea
          ) {
            continue;
          }
          detectedCells.push({
            cellId: '',
            x1: leftWall.x,
            y1: topWall.y,
            x2: rightWall.x,
            y2: bottomWall.y,
            walls,
            wallDetails,
          });
        }
      }
    }
  }

  return dedupeCells(detectedCells);
}

export function blockInCell(blockBbox, cell) {
  if (!Array.isArray(blockBbox) || blockBbox.length !== 4 || !cell) {
    return false;
  }
  const x1 = Number(blockBbox[0]);
  const y1 = Number(blockBbox[1]);
  const x2 = Number(blockBbox[2]);
  const y2 = Number(blockBbox[3]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return false;
  }
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  return (
    centerX >= Number(cell.x1)
    && centerX <= Number(cell.x2)
    && centerY >= Number(cell.y1)
    && centerY <= Number(cell.y2)
  );
}
