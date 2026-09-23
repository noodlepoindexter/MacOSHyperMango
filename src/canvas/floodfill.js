/* ---------------------------------------------------------------------------
   Paint bucket.

   A scanline flood fill, ported from the web version. The tolerance is the
   important part and is deliberately preserved: shapes are drawn antialiased,
   so an exact-match fill stops at the soft edge and leaves a halo. Matching
   within a tolerance of 32 per channel swallows that fringe.
   --------------------------------------------------------------------------- */

const TOLERANCE = 32;

/**
 * Flood fill from a point.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} startX logical x
 * @param {number} startY logical y
 * @param {string} hex    fill colour, #rrggbb
 * @param {number} w      logical width
 * @param {number} h      logical height
 * @param {number} dpr    backing-store scale
 * @returns {boolean} whether anything changed
 */
export function floodFill(ctx, startX, startY, hex, w, h, dpr = 1) {
  // Work in device pixels: the backing store is what actually holds the image.
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  const sx = Math.floor(startX * dpr);
  const sy = Math.floor(startY * dpr);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return false;

  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;

  const fillR = parseInt(hex.slice(1, 3), 16);
  const fillG = parseInt(hex.slice(3, 5), 16);
  const fillB = parseInt(hex.slice(5, 7), 16);

  const start = (sy * W + sx) * 4;
  const tR = data[start];
  const tG = data[start + 1];
  const tB = data[start + 2];
  const tA = data[start + 3];

  // Already the target colour — nothing to do, and filling anyway would loop.
  if (tR === fillR && tG === fillG && tB === fillB && tA === 255) return false;

  const matches = (i) =>
    Math.abs(data[i] - tR) <= TOLERANCE &&
    Math.abs(data[i + 1] - tG) <= TOLERANCE &&
    Math.abs(data[i + 2] - tB) <= TOLERANCE &&
    Math.abs(data[i + 3] - tA) <= TOLERANCE;

  const paint = (i) => {
    data[i] = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    data[i + 3] = 255;
  };

  // Scanline fill: for each seed, walk left and right to the span's limits,
  // fill it, then seed the rows above and below wherever they also match.
  const filled = new Uint8Array(W * H);
  const stack = [[sx, sy]];

  while (stack.length) {
    const [px, py] = stack.pop();
    if (py < 0 || py >= H) continue;

    let x1 = px;
    while (x1 >= 0 && !filled[py * W + x1] && matches((py * W + x1) * 4)) x1--;
    x1++;

    let x2 = px;
    while (x2 < W && !filled[py * W + x2] && matches((py * W + x2) * 4)) x2++;
    x2--;

    if (x1 > x2) continue;

    let spanAbove = false;
    let spanBelow = false;
    for (let x = x1; x <= x2; x++) {
      const idx = py * W + x;
      paint(idx * 4);
      filled[idx] = 1;

      if (py > 0) {
        const up = (py - 1) * W + x;
        const ok = !filled[up] && matches(up * 4);
        if (ok && !spanAbove) {
          stack.push([x, py - 1]);
          spanAbove = true;
        } else if (!ok) {
          spanAbove = false;
        }
      }
      if (py < H - 1) {
        const down = (py + 1) * W + x;
        const ok = !filled[down] && matches(down * 4);
        if (ok && !spanBelow) {
          stack.push([x, py + 1]);
          spanBelow = true;
        } else if (!ok) {
          spanBelow = false;
        }
      }
    }
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  return true;
}
