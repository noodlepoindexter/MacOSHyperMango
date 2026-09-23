/* Pan clamping and zoom-about-a-point. Both are pure arithmetic over the pane
   and card geometry, so they are exercised against a stand-in Surface rather
   than a real DOM. The formulas are kept identical to surface.js. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_W, CARD_H } from '../src/model/stack.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const EDGE_KEEP = 56;

/** Mirrors Surface's pan/zoom maths against a fixed pane size. */
function makeViewport(paneW = 900, paneH = 600) {
  return {
    paneW, paneH,
    zoom: 1,
    pan: { x: 0, y: 0 },

    clampPan() {
      const w = CARD_W * this.zoom;
      const h = CARD_H * this.zoom;
      const limitX = this.paneW / 2 + w / 2 - EDGE_KEEP;
      const limitY = this.paneH / 2 + h / 2 - EDGE_KEEP;
      this.pan.x = Math.max(-limitX, Math.min(limitX, this.pan.x));
      this.pan.y = Math.max(-limitY, Math.min(limitY, this.pan.y));
    },

    panBy(dx, dy) {
      this.pan.x += dx;
      this.pan.y += dy;
      this.clampPan();
    },

    zoomAt(factor, px, py) {
      const z0 = this.zoom;
      const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
      if (Math.abs(z1 - z0) < 1e-6) return;
      const cx = this.paneW / 2 + this.pan.x;
      const cy = this.paneH / 2 + this.pan.y;
      const ax = (px - cx) / z0;
      const ay = (py - cy) / z0;
      this.zoom = z1;
      this.pan.x = px - ax * z1 - this.paneW / 2;
      this.pan.y = py - ay * z1 - this.paneH / 2;
      this.clampPan();
    },

    /** The card's on-screen rect in pane coordinates. */
    rect() {
      const w = CARD_W * this.zoom;
      const h = CARD_H * this.zoom;
      const left = this.paneW / 2 + this.pan.x - w / 2;
      const top = this.paneH / 2 + this.pan.y - h / 2;
      return { left, top, right: left + w, bottom: top + h };
    },

    /** How many pixels of card overlap the pane on each axis. */
    visible() {
      const r = this.rect();
      return {
        x: Math.min(r.right, this.paneW) - Math.max(r.left, 0),
        y: Math.min(r.bottom, this.paneH) - Math.max(r.top, 0),
      };
    },
  };
}

test('panning moves the card by the requested amount', () => {
  const v = makeViewport();
  v.zoom = 0.5;
  v.panBy(40, -25);
  assert.deepEqual(v.pan, { x: 40, y: -25 });
});

test('the card can be pushed far off but never fully out of view', () => {
  const v = makeViewport();
  v.zoom = 0.5;
  for (const [dx, dy] of [[1e6, 0], [-1e6, 0], [0, 1e6], [0, -1e6], [1e6, 1e6]]) {
    const w = makeViewport();
    w.zoom = 0.5;
    w.panBy(dx, dy);
    const vis = w.visible();
    assert.ok(
      vis.x >= EDGE_KEEP - 1e-6 && vis.y >= EDGE_KEEP - 1e-6,
      `only ${vis.x}x${vis.y}px left visible after panning ${dx},${dy}`
    );
  }
  void v;
});

test('a hard shove still leaves the card mostly off screen', () => {
  // The point of free panning: the clamp must not drag the card back to centre.
  const v = makeViewport();
  v.zoom = 0.5;
  v.panBy(1e6, 0);
  const vis = v.visible();
  assert.ok(vis.x < CARD_W * v.zoom * 0.25, 'clamp pulled the card too far back');
});

test('zooming keeps the point under the cursor fixed', () => {
  const v = makeViewport();
  v.zoom = 0.6;

  const px = 700;
  const py = 180;
  // Card-space point currently under the cursor.
  const before = {
    x: (px - (v.paneW / 2 + v.pan.x)) / v.zoom,
    y: (py - (v.paneH / 2 + v.pan.y)) / v.zoom,
  };

  v.zoomAt(1.35, px, py);

  const after = {
    x: (px - (v.paneW / 2 + v.pan.x)) / v.zoom,
    y: (py - (v.paneH / 2 + v.pan.y)) / v.zoom,
  };
  assert.ok(Math.abs(after.x - before.x) < 1e-6, 'x drifted under the cursor');
  assert.ok(Math.abs(after.y - before.y) < 1e-6, 'y drifted under the cursor');
});

test('zoom respects its bounds', () => {
  const v = makeViewport();
  for (let i = 0; i < 80; i++) v.zoomAt(1.5, 450, 300);
  assert.ok(v.zoom <= MAX_ZOOM + 1e-9, `zoom ran past the ceiling: ${v.zoom}`);

  const w = makeViewport();
  for (let i = 0; i < 80; i++) w.zoomAt(1 / 1.5, 450, 300);
  assert.ok(w.zoom >= MIN_ZOOM - 1e-9, `zoom ran past the floor: ${w.zoom}`);
});

test('zooming in then back out returns to the starting view', () => {
  const v = makeViewport();
  v.zoom = 0.6;
  const start = { ...v.pan };
  v.zoomAt(1.35, 620, 240);
  v.zoomAt(1 / 1.35, 620, 240);
  assert.ok(Math.abs(v.zoom - 0.6) < 1e-9, `zoom did not return: ${v.zoom}`);
  assert.ok(Math.abs(v.pan.x - start.x) < 1e-6, 'pan.x did not return');
  assert.ok(Math.abs(v.pan.y - start.y) < 1e-6, 'pan.y did not return');
});

test('the wheel factor is symmetric for equal opposite deltas', () => {
  const inFactor = Math.pow(1.0015, -(-120));
  const outFactor = Math.pow(1.0015, -120);
  assert.ok(Math.abs(inFactor * outFactor - 1) < 1e-9, 'wheel zoom is not reversible');
});
