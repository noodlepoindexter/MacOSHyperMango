/* ---------------------------------------------------------------------------
   The drawing surface.

   Three stacked layers over a fixed 1063x797 logical card:

     paint    the retained bitmap — pencil, shapes, bucket, eraser
     overlay  transient tool previews (rubber-band shapes, polygon guides)
     objects  DOM layer for text and buttons, positioned by CSS

   Two things the web version did not have to deal with:

   * Retina. The backing store is sized to devicePixelRatio while every
     coordinate the tools see stays in logical card space, so `imageData`
     round-trips to the web version unchanged.
   * Zoom. The card is scaled to fit its pane, which means pointer events need
     mapping back through both the zoom factor and the element's box.
   --------------------------------------------------------------------------- */

import { CARD_W, CARD_H } from '../model/stack.js';

/** Zoom bounds. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** How much of the card must stay within the pane when panning, in screen px. */
const EDGE_KEEP = 56;

export class Surface {
  /**
   * @param {HTMLElement} container element holding the layers
   */
  constructor(container) {
    this.container = container;
    this.zoom = 1;
    this.mode = 'fit'; // 'fit' | 'actual' | explicit number
    // Pan offset in screen pixels, measured from the card's centred position.
    this.pan = { x: 0, y: 0 };

    this.paint = container.querySelector('#paint-canvas');
    this.overlay = container.querySelector('#overlay-canvas');
    this.objects = container.querySelector('#object-layer');

    this.ctx = this.paint.getContext('2d', { willReadFrequently: true });
    this.octx = this.overlay.getContext('2d');

    this.dpr = window.devicePixelRatio || 1;
    this.initBacking();
  }

  /**
   * Size both canvases' backing stores for the current pixel ratio and scale
   * their contexts so all drawing code works in logical coordinates.
   */
  initBacking() {
    for (const [cnv, ctx] of [
      [this.paint, this.ctx],
      [this.overlay, this.octx],
    ]) {
      cnv.width = Math.round(CARD_W * this.dpr);
      cnv.height = Math.round(CARD_H * this.dpr);
      cnv.style.width = `${CARD_W}px`;
      cnv.style.height = `${CARD_H}px`;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  /** Re-establish backing when the window moves to a display with a different
      pixel ratio. The paint layer is preserved across the resize. */
  async handleDprChange() {
    const next = window.devicePixelRatio || 1;
    if (next === this.dpr) return;
    const snapshot = this.toDataURL();
    this.dpr = next;
    this.initBacking();
    await this.loadImage(snapshot);
  }

  // --- zoom ---------------------------------------------------------------

  setZoom(value) {
    this.mode = value;
    this.applyZoom();
  }

  applyZoom() {
    const pane = this.container.parentElement;
    if (!pane) return;

    if (this.mode === 'fit') {
      // Leave a margin so the card does not touch the pane edges.
      const margin = 48;
      const sx = (pane.clientWidth - margin) / CARD_W;
      const sy = (pane.clientHeight - margin) / CARD_H;
      this.zoom = Math.max(MIN_ZOOM, Math.min(sx, sy, 1));
      // Fitting re-centres: a leftover pan would defeat the point.
      this.pan.x = 0;
      this.pan.y = 0;
    } else if (this.mode === 'actual') {
      this.zoom = 1;
    } else {
      this.zoom = this.mode;
    }

    this.container.style.width = `${CARD_W}px`;
    this.container.style.height = `${CARD_H}px`;
    this.clampPan();
    this.applyTransform();
  }

  /** Translate first, then scale: the pan stays in screen pixels either way. */
  applyTransform() {
    this.container.style.transform =
      `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  /**
   * Keep at least a corner of the card on screen. The card may be pushed almost
   * entirely out of view — that is the point of panning freely — but never so
   * far that there is nothing left to grab.
   */
  clampPan() {
    const pane = this.container.parentElement;
    if (!pane) return;
    const w = CARD_W * this.zoom;
    const h = CARD_H * this.zoom;
    const pw = pane.clientWidth;
    const ph = pane.clientHeight;

    const limitX = pw / 2 + w / 2 - EDGE_KEEP;
    const limitY = ph / 2 + h / 2 - EDGE_KEEP;
    this.pan.x = Math.max(-limitX, Math.min(limitX, this.pan.x));
    this.pan.y = Math.max(-limitY, Math.min(limitY, this.pan.y));
  }

  /** Nudge the card by a screen-space delta. */
  panBy(dx, dy) {
    this.pan.x += dx;
    this.pan.y += dy;
    // Panning is an explicit placement, so stop re-centring on resize.
    if (this.mode === 'fit') this.mode = this.zoom;
    this.clampPan();
    this.applyTransform();
  }

  /**
   * Zoom about a screen point, keeping whatever sits under it fixed. Without
   * this, zooming always pulls toward the pane centre and the thing you were
   * looking at slides away.
   */
  zoomAt(factor, clientX, clientY) {
    const pane = this.container.parentElement;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();

    const z0 = this.zoom;
    const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
    if (Math.abs(z1 - z0) < 1e-6) return;

    // Pane-local cursor, and the card-space point currently beneath it.
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cx = rect.width / 2 + this.pan.x;
    const cy = rect.height / 2 + this.pan.y;
    const ax = (px - cx) / z0;
    const ay = (py - cy) / z0;

    this.zoom = z1;
    this.mode = z1;
    this.pan.x = px - ax * z1 - rect.width / 2;
    this.pan.y = py - ay * z1 - rect.height / 2;
    this.clampPan();
    this.applyTransform();
  }

  /** Zoom about the centre of the pane, for menu commands. */
  zoomBy(factor) {
    const pane = this.container.parentElement;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // --- coordinates --------------------------------------------------------

  /**
   * Map a pointer event to logical card coordinates.
   * @param {PointerEvent|MouseEvent} e
   * @param {boolean} clamp keep the result inside the card
   */
  pointFrom(e, clamp = false) {
    const rect = this.paint.getBoundingClientRect();
    // rect is already post-transform, so dividing by its size rather than by
    // this.zoom keeps the mapping correct even mid-transition.
    let x = ((e.clientX - rect.left) / rect.width) * CARD_W;
    let y = ((e.clientY - rect.top) / rect.height) * CARD_H;
    if (clamp) {
      x = Math.max(0, Math.min(CARD_W, x));
      y = Math.max(0, Math.min(CARD_H, y));
    }
    return { x, y };
  }

  /**
   * Clip a point back inside the card along the line it arrived on.
   *
   * Used by multi-click tools: when a vertex is placed outside the card, the
   * useful interpretation is the point where the segment from the previous
   * vertex leaves the card, not an axis-wise clamp — clamping each axis
   * independently moves the point off that line and skews the shape.
   *
   * Liang–Barsky parametric clipping; `from` is assumed to be inside.
   *
   * @param {{x:number,y:number}} from  last point known to be inside
   * @param {{x:number,y:number}} to    candidate point, possibly outside
   * @param {number} inset              how far inside the edge to land
   */
  clipIntoCard(from, to, inset = 1) {
    const lo = inset;
    const hiX = CARD_W - inset;
    const hiY = CARD_H - inset;

    if (to.x >= lo && to.x <= hiX && to.y >= lo && to.y <= hiY) {
      return { x: to.x, y: to.y };
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const axisClamp = () => ({
      x: Math.max(lo, Math.min(hiX, to.x)),
      y: Math.max(lo, Math.min(hiY, to.y)),
    });
    if (dx === 0 && dy === 0) return axisClamp();

    // Each boundary as p*t <= q; p<0 entering, p>0 leaving.
    const p = [-dx, dx, -dy, dy];
    const q = [from.x - lo, hiX - from.x, from.y - lo, hiY - from.y];
    let t0 = 0;
    let t1 = 1;

    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        // Parallel to this edge and already outside it — no valid crossing.
        if (q[i] < 0) return axisClamp();
        continue;
      }
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return axisClamp();
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return axisClamp();
        if (r < t1) t1 = r;
      }
    }

    const t = Math.max(0, Math.min(1, t1));
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  /** Distance in on-screen pixels, for hit tolerances that should feel the
      same regardless of zoom. */
  screenDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) * this.zoom;
  }

  // --- paint layer --------------------------------------------------------

  clearOverlay() {
    this.octx.clearRect(0, 0, CARD_W, CARD_H);
  }

  /** Reset the paint layer to opaque white — cards are never transparent. */
  clearPaint() {
    this.ctx.clearRect(0, 0, CARD_W, CARD_H);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, CARD_W, CARD_H);
  }

  toDataURL() {
    // Render through a 1x canvas so exported images stay 1063x797 regardless
    // of the display's pixel ratio, keeping .hweb interop exact.
    if (this.dpr === 1) return this.paint.toDataURL('image/png');
    const flat = document.createElement('canvas');
    flat.width = CARD_W;
    flat.height = CARD_H;
    flat.getContext('2d').drawImage(this.paint, 0, 0, CARD_W, CARD_H);
    return flat.toDataURL('image/png');
  }

  async toBlob() {
    const url = this.toDataURL();
    return (await fetch(url)).blob();
  }

  /** Replace the paint layer with an image, or clear it when given null. */
  loadImage(src) {
    return new Promise((resolve) => {
      this.clearPaint();
      if (!src) {
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src instanceof Blob ? URL.createObjectURL(src) : src;
    });
  }
}
