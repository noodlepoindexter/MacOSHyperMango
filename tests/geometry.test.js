/* Segment clipping for multi-click tools. Pure geometry, so it is tested
   directly against the Surface method rather than through the DOM. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CARD_W, CARD_H } from '../src/model/stack.js';

// surface.js reaches for `window` at import time, so lift just the method
// under test into a standalone function rather than importing the module.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'canvas', 'surface.js'), 'utf8');
const body = src.slice(
  src.indexOf('clipIntoCard(from, to, inset = 1) {'),
  src.indexOf('/** Distance in on-screen pixels')
);
const clipIntoCard = new vm.Script(
  `(function (CARD_W, CARD_H) { return function ${body.replace(
    'clipIntoCard(from, to, inset = 1) {',
    'clipIntoCard(from, to, inset = 1) {'
  )}; })`
).runInThisContext()(CARD_W, CARD_H);

const inside = (p) =>
  p.x >= 0 && p.x <= CARD_W && p.y >= 0 && p.y <= CARD_H;

/** Is `p` on the segment from a to b (within a small tolerance)? */
function onSegment(a, b, p, tol = 1e-6) {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs(cross) / len <= tol;
}

test('a point already inside is returned unchanged', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 400, y: 300 };
  assert.deepEqual(clipIntoCard(from, to), { x: 400, y: 300 });
});

test('a point beyond the right edge lands on that edge, on the same line', () => {
  const from = { x: 500, y: 400 };
  const to = { x: CARD_W + 500, y: 400 };
  const got = clipIntoCard(from, to);
  assert.ok(inside(got));
  assert.equal(Math.round(got.y), 400, 'stays on the horizontal line');
  assert.ok(got.x > CARD_W - 5 && got.x <= CARD_W, `landed at x=${got.x}`);
});

test('a diagonal exit stays on the line between the two points', () => {
  const from = { x: 200, y: 200 };
  const to = { x: 2000, y: 1400 };
  const got = clipIntoCard(from, to);
  assert.ok(inside(got), `clipped point outside card: ${JSON.stringify(got)}`);
  assert.ok(onSegment(from, to, got, 1e-6), 'clipped point left the segment');
});

test('axis-wise clamping would be wrong, and is not what happens', () => {
  // Far off the bottom-right corner: clamping each axis independently gives
  // the corner, which is not on the line.
  const from = { x: 100, y: 700 };
  const to = { x: 3000, y: 900 };
  const got = clipIntoCard(from, to);
  const naive = {
    x: Math.max(0, Math.min(CARD_W, to.x)),
    y: Math.max(0, Math.min(CARD_H, to.y)),
  };
  assert.ok(onSegment(from, to, got, 1e-6));
  assert.ok(
    Math.hypot(got.x - naive.x, got.y - naive.y) > 1,
    'clipped result should differ from a naive axis clamp here'
  );
});

test('exits through the top edge when heading up', () => {
  const from = { x: 400, y: 100 };
  const to = { x: 400, y: -500 };
  const got = clipIntoCard(from, to);
  assert.ok(inside(got));
  assert.equal(Math.round(got.x), 400);
  assert.ok(got.y >= 0 && got.y < 5, `landed at y=${got.y}`);
});

test('the inset keeps the point strictly inside the card', () => {
  const from = { x: 500, y: 400 };
  for (const to of [
    { x: 9999, y: 400 },
    { x: -9999, y: 400 },
    { x: 500, y: 9999 },
    { x: 500, y: -9999 },
    { x: 9999, y: 9999 },
  ]) {
    const got = clipIntoCard(from, to, 1);
    assert.ok(
      got.x >= 1 - 1e-9 && got.x <= CARD_W - 1 + 1e-9 &&
      got.y >= 1 - 1e-9 && got.y <= CARD_H - 1 + 1e-9,
      `point not inset: ${JSON.stringify(got)}`
    );
  }
});

test('a zero-length segment falls back to an axis clamp', () => {
  const from = { x: 5000, y: 5000 };
  const got = clipIntoCard(from, { x: 5000, y: 5000 });
  assert.ok(inside(got));
});
