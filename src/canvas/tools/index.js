/* Tool registry.

   Each tool is an object with `onDown`/`onMove`/`onUp`/`onCancel`, optionally
   `onDoubleClick`, and a `cursor`. The editor owns a ToolContext and hands it
   to whichever tool is active — tools never touch the model or the DOM
   directly, which keeps drawing logic testable and stops each tool from
   growing its own idea of how undo works. */

import { makePencil } from './pencil.js';
import { makeShape } from './shapes.js';
import { makeBucket } from './bucket.js';
import { makeLasso } from './lasso.js';
import { makePolygon } from './polygon.js';

/** Tools that place objects or select rather than paint are handled by the
    editor directly; they appear here so the toolbar can render uniformly. */
export const TOOL_IDS = [
  'pointer', 'pencil', 'eraser', 'rect', 'ellipse', 'fillRect',
  'bucket', 'lasso', 'polygon', 'text', 'button',
];

export function createTools() {
  return {
    pencil: makePencil(false),
    eraser: makePencil(true),
    rect: makeShape('rect'),
    ellipse: makeShape('ellipse'),
    fillRect: makeShape('fillRect'),
    bucket: makeBucket(),
    lasso: makeLasso(),
    polygon: makePolygon(),
  };
}

/**
 * What tools are handed on each event. `target` lets a tool paint into a
 * canvas button's surface instead of the card, which is how the web version's
 * drawable buttons worked.
 */
export class ToolContext {
  constructor(surface, style, hooks) {
    this.surface = surface;
    this.style = style;
    this.hooks = hooks;
    this.target = null; // null = the card's paint layer
  }

  /** The 2D context the active tool should draw into. */
  ctx() {
    return this.target ? this.target.ctx : this.surface.ctx;
  }

  /**
   * Begin a transient preview on the overlay layer.
   *
   * Tools work in the coordinate space of whatever they are drawing into, but
   * the overlay always spans the card. When the target is a canvas button those
   * two spaces differ by the button's origin, so a preview drawn naively lands
   * offset by exactly that much. Translating here keeps every tool's preview
   * code identical whether it is painting the card or a button, and the clip
   * matches the bounds the real stroke will be confined to.
   *
   * Always pair with endPreview().
   */
  beginPreview() {
    const ctx = this.surface.octx;
    this.surface.clearOverlay();
    ctx.save();
    if (this.target) {
      const b = this.target.button;
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      ctx.translate(b.x, b.y);
    }
    return ctx;
  }

  endPreview(ctx) {
    ctx.restore();
  }

  pushUndo() {
    this.hooks.pushUndo();
  }

  /** Discard the snapshot just pushed, for a no-op edit. */
  dropUndo() {
    this.hooks.dropUndo();
  }

  commit() {
    this.hooks.commit();
  }
}
