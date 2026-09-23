/* Paint bucket. A single click, no drag state. */

import { floodFill } from '../floodfill.js';
import { CARD_W, CARD_H } from '../../model/stack.js';

export function makeBucket() {
  return {
    id: 'bucket',
    cursor: 'copy',

    onDown(t, p) {
      const colour = t.style.fill || t.style.stroke;
      if (!colour) return;
      t.pushUndo();
      const changed = floodFill(
        t.ctx(),
        p.x,
        p.y,
        colour,
        CARD_W,
        CARD_H,
        t.surface.dpr
      );
      if (changed) t.commit();
      else t.dropUndo();
    },

    onMove() {},
    onUp() {},
    onCancel() {},
  };
}
