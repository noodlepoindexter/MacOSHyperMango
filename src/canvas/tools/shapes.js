/* Rectangle, ellipse, filled rectangle and filled ellipse. All rubber-band on the
   overlay layer and commit to the paint layer on release, so an abandoned drag
   leaves nothing behind. */

import { CARD_W, CARD_H } from '../../model/stack.js';

/**
 * @param {'rect'|'ellipse'|'fillRect'|'fillEllipse'} kind
 */
export function makeShape(kind) {
  return {
    id: kind,
    cursor: 'crosshair',

    onDown(t, p) {
      this.start = p;
    },

    onMove(t, p) {
      if (!this.start) return;
      const ctx = t.beginPreview();
      draw(ctx, kind, this.start, p, t.style, true);
      t.endPreview(ctx);
    },

    onUp(t, p) {
      if (!this.start) return;
      t.surface.clearOverlay();
      // Ignore accidental click-without-drag.
      if (Math.abs(p.x - this.start.x) < 1 && Math.abs(p.y - this.start.y) < 1) {
        this.start = null;
        return;
      }
      t.pushUndo();
      draw(t.ctx(), kind, this.start, p, t.style, false);
      this.start = null;
      t.commit();
    },

    onCancel(t) {
      this.start = null;
      t.surface.clearOverlay();
    },
  };
}

function draw(ctx, kind, a, b, style, isPreview) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  ctx.save();
  if (isPreview) {
    // Dashed guide so the preview reads as provisional.
    ctx.setLineDash([5, 4]);
  }

  if (kind === 'fillRect') {
    // The dedicated fill tool paints a solid block of the stroke colour,
    // matching the web version's "fill (rectangle interior)" tool.
    ctx.fillStyle = isPreview ? withAlpha(style.stroke, 0.4) : style.stroke;
    ctx.fillRect(clampX(x), clampY(y), w, h);
    ctx.restore();
    return;
  }
  if (kind === 'fillEllipse') {
    // Its oval counterpart: a solid ellipse in the stroke colour.
    ctx.fillStyle = isPreview ? withAlpha(style.stroke, 0.4) : style.stroke;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.lineWidth = style.size;
  ctx.strokeStyle = style.stroke;

  ctx.beginPath();
  if (kind === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(x, y, w, h);
  }
  if (style.fill && !isPreview) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.stroke) ctx.stroke();
  ctx.restore();
}

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const clampX = (v) => Math.max(0, Math.min(CARD_W, v));
const clampY = (v) => Math.max(0, Math.min(CARD_H, v));
