/* Freehand pencil and eraser. The eraser is the same stroke path painted with
   white rather than a destination-out composite, because cards are opaque and
   erasing to transparent would let the workspace show through. */

export function makePencil(erase = false) {
  return {
    id: erase ? 'eraser' : 'pencil',
    cursor: erase ? 'cell' : 'crosshair',

    onDown(t, p) {
      t.pushUndo();
      const ctx = t.ctx();
      ctx.save();
      ctx.strokeStyle = erase ? '#ffffff' : t.style.stroke;
      ctx.lineWidth = erase ? Math.max(t.style.size * 2, 8) : t.style.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // A zero-length drag should still leave a dot.
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
      ctx.stroke();
      this.last = p;
    },

    onMove(t, p) {
      if (!this.last) return;
      const ctx = t.ctx();
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      this.last = p;
    },

    onUp(t) {
      if (!this.last) return;
      t.ctx().restore();
      this.last = null;
      t.commit();
    },

    onCancel(t) {
      if (this.last) t.ctx().restore();
      this.last = null;
    },
  };
}
