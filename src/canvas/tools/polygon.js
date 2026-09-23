/* Polygon.

   Click to place vertices; the shape closes when you click near the first
   vertex or double-click. The snap radius is measured in screen pixels so the
   target feels the same size at every zoom level — the web version measured in
   card space, which made closing a polygon fiddly when zoomed out. */

import { CARD_W, CARD_H } from '../../model/stack.js';

const SNAP_RADIUS_PX = 12;

export function makePolygon() {
  return {
    id: 'polygon',
    cursor: 'crosshair',
    // Multi-click tools stay armed between events rather than tracking a drag.
    isMultiClick: true,
    // Points arrive unclamped so a vertex placed outside the card can be
    // clipped along its own segment rather than squashed axis-wise.
    wantsRawPoints: true,

    onDown(t, p) {
      if (!this.points) this.points = [];
      const pt = this.constrain(t, p);

      if (this.points.length >= 3 && this.nearFirst(t, pt)) {
        this.commitShape(t);
        return;
      }
      this.points.push(pt);
      this.preview(t, pt);
    },

    onMove(t, p) {
      if (!this.points || this.points.length === 0) return;
      this.preview(t, this.constrain(t, p));
    },

    /**
     * Bring a candidate vertex inside the card. With a previous vertex to work
     * from, the point slides back along that segment; for the very first vertex
     * there is no line yet, so an axis clamp is all that is meaningful.
     */
    constrain(t, p) {
      const last = this.points[this.points.length - 1];
      if (!last) {
        return {
          x: Math.max(1, Math.min(CARD_W - 1, p.x)),
          y: Math.max(1, Math.min(CARD_H - 1, p.y)),
        };
      }
      return t.surface.clipIntoCard(last, p);
    },

    onUp() {},

    /** True while a shape is part-built, so the editor keeps the draw target. */
    isPending() {
      return !!(this.points && this.points.length > 0);
    },

    onDoubleClick(t) {
      if (this.points && this.points.length >= 3) this.commitShape(t);
      else this.onCancel(t);
    },

    nearFirst(t, p) {
      return t.surface.screenDistance(this.points[0], p) <= SNAP_RADIUS_PX;
    },

    preview(t, cursor) {
      const ctx = t.beginPreview();
      ctx.lineWidth = t.style.size;
      ctx.strokeStyle = t.style.stroke || '#000000';
      ctx.setLineDash([4, 3]);

      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
      if (cursor) ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();

      // Vertex handles, plus a highlighted first vertex once closing is legal.
      ctx.setLineDash([]);
      const snapping = this.points.length >= 3 && cursor && this.nearFirst(t, cursor);
      this.points.forEach((pt, i) => {
        const first = i === 0;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, first && snapping ? 7 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = first && snapping ? '#e8792b' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#333333';
        ctx.stroke();
      });
      t.endPreview(ctx);
    },

    commitShape(t) {
      const pts = this.points;
      this.points = null;
      t.surface.clearOverlay();
      if (!pts || pts.length < 3) return;

      t.pushUndo();
      const ctx = t.ctx();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
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
