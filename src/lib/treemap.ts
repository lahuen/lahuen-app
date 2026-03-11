/**
 * Squarified Treemap Layout Algorithm
 * Based on Bruls, Huizing, van Wijk (2000)
 *
 * Outputs percentage-based coordinates (0-100) so CSS handles responsiveness natively.
 */

export interface TreemapItem {
  id: string;
  value: number;
}

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  item: TreemapItem;
}

/**
 * Compute a squarified treemap layout.
 * @param items - Items to lay out (value > 0 required; pre-filter zeros)
 * @param containerW - Container width in pixels (for aspect ratio decisions)
 * @param containerH - Container height in pixels
 * @returns Array of rects with x/y/w/h in percentages (0-100)
 */
export function computeTreemapLayout(
  items: TreemapItem[],
  containerW: number,
  containerH: number,
): TreemapRect[] {
  if (items.length === 0) return [];

  // Filter and sort descending by value
  const sorted = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return [];

  const totalValue = sorted.reduce((s, i) => s + i.value, 0);

  // Normalize values to total area (percentage space: 100 * 100 = 10000)
  const totalArea = 100 * 100;
  const areas = sorted.map(i => (i.value / totalValue) * totalArea);

  const rects: TreemapRect[] = [];

  // Work in actual pixel space for aspect ratio calculations, then convert to %
  squarify(
    sorted,
    areas,
    { x: 0, y: 0, w: containerW, h: containerH },
    rects,
    containerW,
    containerH,
  );

  return rects;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(
  items: TreemapItem[],
  areas: number[],
  rect: Rect,
  output: TreemapRect[],
  totalW: number,
  totalH: number,
): void {
  if (items.length === 0) return;

  if (items.length === 1) {
    output.push({
      x: (rect.x / totalW) * 100,
      y: (rect.y / totalH) * 100,
      w: (rect.w / totalW) * 100,
      h: (rect.h / totalH) * 100,
      item: items[0],
    });
    return;
  }

  // Scale areas to fit current rect
  const rectArea = rect.w * rect.h;
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const scaled = areas.map(a => (a / totalArea) * rectArea);

  const isWide = rect.w >= rect.h;
  const side = isWide ? rect.h : rect.w;

  let row: number[] = [scaled[0]];
  let rowItems: TreemapItem[] = [items[0]];
  let bestRatio = worstRatio(row, side);

  for (let i = 1; i < items.length; i++) {
    const testRow = [...row, scaled[i]];
    const testRatio = worstRatio(testRow, side);

    if (testRatio <= bestRatio) {
      row = testRow;
      rowItems.push(items[i]);
      bestRatio = testRatio;
    } else {
      // Lay out current row and recurse on remainder
      const remaining = layoutRow(rowItems, row, rect, isWide, output, totalW, totalH);
      squarify(
        items.slice(i),
        scaled.slice(i),
        remaining,
        output,
        totalW,
        totalH,
      );
      return;
    }
  }

  // Lay out final row
  layoutRow(rowItems, row, rect, isWide, output, totalW, totalH);
}

function worstRatio(row: number[], side: number): number {
  const sum = row.reduce((s, v) => s + v, 0);
  const s2 = side * side;
  let worst = 0;
  for (const v of row) {
    const r = Math.max((s2 * v) / (sum * sum), (sum * sum) / (s2 * v));
    if (r > worst) worst = r;
  }
  return worst;
}

function layoutRow(
  items: TreemapItem[],
  areas: number[],
  rect: Rect,
  isWide: boolean,
  output: TreemapRect[],
  totalW: number,
  totalH: number,
): Rect {
  const rowSum = areas.reduce((s, a) => s + a, 0);

  if (isWide) {
    // Row fills from left, height = rect.h, width = rowSum / rect.h
    const rowWidth = rowSum / rect.h;
    let y = rect.y;
    for (let i = 0; i < items.length; i++) {
      const h = areas[i] / rowWidth;
      output.push({
        x: (rect.x / totalW) * 100,
        y: (y / totalH) * 100,
        w: (rowWidth / totalW) * 100,
        h: (h / totalH) * 100,
        item: items[i],
      });
      y += h;
    }
    // Return remaining rect
    return { x: rect.x + rowWidth, y: rect.y, w: rect.w - rowWidth, h: rect.h };
  } else {
    // Row fills from top, width = rect.w, height = rowSum / rect.w
    const rowHeight = rowSum / rect.w;
    let x = rect.x;
    for (let i = 0; i < items.length; i++) {
      const w = areas[i] / rowHeight;
      output.push({
        x: (x / totalW) * 100,
        y: (rect.y / totalH) * 100,
        w: (w / totalW) * 100,
        h: (rowHeight / totalH) * 100,
        item: items[i],
      });
      x += w;
    }
    return { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: rect.h - rowHeight };
  }
}
