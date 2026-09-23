/* Filled shape pencil.

   Draw a freehand outline; on release the path is closed and filled. The web
   version called this the "lasso" tool, though it selects nothing — it is a
   shape-drawing tool whose outline happens to be freehand. */

export function makeLasso() {
  return {
    id: 'lasso',
    cursor: 'crosshair',

    onDown(t, p) {
      this.points = [p];
    },

    onMove(t, p) {
      if (!this.points) return;
      // Drop near-duplicate points so the path stays cheap on long drags.
      const last = this.points[this.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      this.points.push(p);

      const ctx = t.beginPreview();
      ctx.lineWidth = t.style.size;
      ctx.strokeStyle = t.style.stroke || '#000000';
      ctx.setLineDash([4, 3]);
      trace(ctx, this.points, false);
      ctx.stroke();
      t.endPreview(ctx);
    },

    onUp(t) {
      const pts = this.points;
      this.points = null;
      t.surface.clearOverlay();
      // Fewer than three points cannot enclose an area.
      if (!pts || pts.length < 3) return;

      t.pushUndo();
      const ctx = t.ctx();
      ctx.save();
      trace(ctx, pts, true);
      if (t.style.fill) {
        ctx.fillStyle = t.style.fill;
        ctx.fill();
      }
      if (t.style.stroke) {
        ctx.lineWidth = t.style.size;
        ctx.strokeStyle = t.style.stroke;
        ctx.stroke();
      }
      ctx.restore();
      t.commit();
    },

    onCancel(t) {
      this.points = null;
      t.surface.clearOverlay();
    },
  };
}

function trace(ctx, pts, close) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}
