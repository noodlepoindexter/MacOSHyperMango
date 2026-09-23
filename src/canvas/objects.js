/* ---------------------------------------------------------------------------
   Text and button objects.

   These live in a DOM layer above the paint canvas rather than being painted
   into it, so they stay movable, editable, and addressable from scripts.

   The editor shows selection handles and allows drag/resize; property editing
   happens in the inspector, not in a modal dialog as the web version did.
   --------------------------------------------------------------------------- */

import { CARD_W, CARD_H } from '../model/stack.js';

/** Corner and edge handles, as [id, cursor, dx, dy] where d* pick which edges move. */
const HANDLES = [
  ['nw', 'nwse-resize', -1, -1],
  ['n', 'ns-resize', 0, -1],
  ['ne', 'nesw-resize', 1, -1],
  ['e', 'ew-resize', 1, 0],
  ['se', 'nwse-resize', 1, 1],
  ['s', 'ns-resize', 0, 1],
  ['sw', 'nesw-resize', -1, 1],
  ['w', 'ew-resize', -1, 0],
];

const MIN_SIZE = 16;

export class ObjectLayer {
  /**
   * @param {HTMLElement} root  the #object-layer element
   * @param {object} callbacks  { onSelect, onChange, onCommit, onOpenScript }
   */
  constructor(root, surface, callbacks) {
    this.root = root;
    this.surface = surface;
    this.cb = callbacks;
    this.selection = null; // {kind:'text'|'button', id}
    this.editing = null;
    this.card = null;
    this.interactive = true;
  }

  setCard(card) {
    this.card = card;
    this.selection = null;
    this.render();
  }

  select(kind, id) {
    this.selection = kind && id ? { kind, id } : null;
    this.render();
    this.cb.onSelect?.(this.selection);
  }

  deselect() {
    if (this.editing) this.commitEdit();
    this.select(null, null);
  }

  selected() {
    if (!this.selection || !this.card) return null;
    const list = this.selection.kind === 'text' ? this.card.textObjects : this.card.buttons;
    return list.find((o) => o.id === this.selection.id) || null;
  }

  /** Hit-test a logical point against buttons, topmost first. */
  buttonAt(pt) {
    if (!this.card) return null;
    for (let i = this.card.buttons.length - 1; i >= 0; i--) {
      const b = this.card.buttons[i];
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return b;
    }
    return null;
  }

  /** The currently mounted element for an object id, if any. */
  liveElement(id) {
    return this.root.querySelector(`[data-id="${id}"]`);
  }

  render() {
    if (!this.card) return;
    this.root.innerHTML = '';
    this.root.style.width = `${CARD_W}px`;
    this.root.style.height = `${CARD_H}px`;

    // Buttons first, then text: text placed over a button — a label on a
    // canvas button, say — has to be visible, and in play mode text objects
    // are pointer-events:none so clicks still reach the button beneath.
    for (const b of this.card.buttons) this.root.appendChild(this.renderButton(b));
    for (const t of this.card.textObjects) this.root.appendChild(this.renderText(t));
  }

  // --- text ---------------------------------------------------------------

  renderText(obj) {
    const el = document.createElement('div');
    el.className = 'obj obj-text';
    el.dataset.id = obj.id;
    this.position(el, obj);
    el.style.fontFamily = obj.fontFamily;
    el.style.fontSize = `${obj.fontSize}px`;
    el.style.color = obj.color;
    el.textContent = obj.content;

    if (!this.interactive) {
      el.classList.add('static');
      return el;
    }

    // The script-visible name is shown as a badge so users know what to write.
    const badge = document.createElement('span');
    badge.className = 'obj-badge';
    badge.textContent = obj.id;
    el.appendChild(badge);

    const isSelected = this.selection?.kind === 'text' && this.selection.id === obj.id;
    if (isSelected) {
      el.classList.add('selected');
      this.addHandles(el, obj, 'text');
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('obj-handle')) return;
      e.stopPropagation();
      this.select('text', obj.id);
      // select() re-renders the layer, which detaches `el`. Dragging the stale
      // node would move nothing on screen and only appear to jump when the
      // layer next rebuilt, so pick up the element that is actually live.
      this.startDrag(e, obj, this.liveElement(obj.id) || el, 'text');
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.startEdit(obj, el);
    });
    return el;
  }

  /** Inline editing: the element becomes contenteditable in place. */
  startEdit(obj, el) {
    if (this.editing) this.commitEdit();
    this.editing = { obj, el };
    el.classList.add('editing');
    el.querySelector('.obj-badge')?.remove();
    el.querySelectorAll('.obj-handle').forEach((h) => h.remove());
    el.contentEditable = 'plaintext-only';
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    el.addEventListener('blur', () => this.commitEdit(), { once: true });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep editor shortcuts from firing while typing
      if (e.key === 'Escape') {
        e.preventDefault();
        el.blur();
      }
    });
  }

  commitEdit() {
    if (!this.editing) return;
    const { obj, el } = this.editing;
    this.editing = null;
    const text = el.textContent ?? '';
    el.contentEditable = 'false';
    if (text !== obj.content) {
      obj.content = text;
      this.cb.onCommit?.();
    }
    // An empty text object is invisible and unusable — remove it.
    if (!text.trim()) this.removeObject('text', obj.id);
    else this.render();
  }

  // --- buttons ------------------------------------------------------------

  renderButton(obj) {
    const el = document.createElement('div');
    el.className = 'obj obj-button';
    el.dataset.id = obj.id;
    this.position(el, obj);

    if (obj.isCanvas) {
      el.classList.add('is-canvas');
      const cnv = document.createElement('canvas');
      cnv.width = Math.round(obj.w * this.surface.dpr);
      cnv.height = Math.round(obj.h * this.surface.dpr);
      cnv.style.width = '100%';
      cnv.style.height = '100%';
      el.appendChild(cnv);
      if (obj.canvasData) {
        const img = new Image();
        img.onload = () => cnv.getContext('2d').drawImage(img, 0, 0, cnv.width, cnv.height);
        img.src = obj.canvasData;
      }
    } else {
      const label = document.createElement('span');
      label.className = 'obj-button-label';
      label.textContent = obj.label;
      el.appendChild(label);
    }

    if (obj.invisible) el.classList.add('invisible');

    if (!this.interactive) {
      el.classList.add('static');
      return el;
    }

    const badge = document.createElement('span');
    badge.className = 'obj-badge';
    badge.textContent = obj.nameId;
    el.appendChild(badge);

    const isSelected = this.selection?.kind === 'button' && this.selection.id === obj.id;
    if (isSelected) {
      el.classList.add('selected');
      this.addHandles(el, obj, 'button');
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('obj-handle')) return;
      e.stopPropagation();
      this.select('button', obj.id);
      // select() re-renders the layer, which detaches `el`. Dragging the stale
      // node would move nothing on screen and only appear to jump when the
      // layer next rebuilt, so pick up the element that is actually live.
      this.startDrag(e, obj, this.liveElement(obj.id) || el, 'button');
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.cb.onOpenScript?.('button', obj.id);
    });
    return el;
  }

  // --- shared geometry ----------------------------------------------------

  position(el, obj) {
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = `${obj.w}px`;
    el.style.height = `${obj.h}px`;
  }

  addHandles(el, obj, kind) {
    for (const [id, cursor, dx, dy] of HANDLES) {
      const h = document.createElement('div');
      h.className = `obj-handle handle-${id}`;
      h.style.cursor = cursor;
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startResize(e, obj, el, dx, dy, kind);
      });
      el.appendChild(h);
    }
  }

  startDrag(e, obj, el, kind) {
    if (this.editing) return;
    const start = this.surface.pointFrom(e);
    const ox = obj.x;
    const oy = obj.y;
    let moved = false;
    this.cb.onBeforeChange?.();

    const move = (ev) => {
      const p = this.surface.pointFrom(ev);
      let nx = ox + (p.x - start.x);
      let ny = oy + (p.y - start.y);
      // Keep at least part of the object on the card.
      nx = Math.max(-obj.w + MIN_SIZE, Math.min(CARD_W - MIN_SIZE, nx));
      ny = Math.max(-obj.h + MIN_SIZE, Math.min(CARD_H - MIN_SIZE, ny));
      if (Math.abs(nx - ox) > 0.5 || Math.abs(ny - oy) > 0.5) moved = true;
      obj.x = Math.round(nx);
      obj.y = Math.round(ny);
      this.position(el, obj);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.cb.onCommit?.();
      else this.cb.onCancelChange?.();
      this.cb.onSelect?.(this.selection);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  startResize(e, obj, el, dx, dy, kind) {
    const start = this.surface.pointFrom(e);
    const box = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    this.cb.onBeforeChange?.();

    const move = (ev) => {
      const p = this.surface.pointFrom(ev);
      const mx = p.x - start.x;
      const my = p.y - start.y;

      let { x, y, w, h } = box;
      if (dx === -1) {
        // Dragging a west edge moves the origin and shrinks the width.
        const nw = Math.max(MIN_SIZE, w - mx);
        x = x + (w - nw);
        w = nw;
      } else if (dx === 1) {
        w = Math.max(MIN_SIZE, w + mx);
      }
      if (dy === -1) {
        const nh = Math.max(MIN_SIZE, h - my);
        y = y + (h - nh);
        h = nh;
      } else if (dy === 1) {
        h = Math.max(MIN_SIZE, h + my);
      }

      obj.x = Math.round(x);
      obj.y = Math.round(y);
      obj.w = Math.round(w);
      obj.h = Math.round(h);
      this.position(el, obj);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // A canvas button's bitmap is tied to its pixel size, so re-render it.
      if (obj.isCanvas) this.render();
      this.cb.onCommit?.();
      this.cb.onSelect?.(this.selection);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  removeObject(kind, id) {
    if (!this.card) return;
    const list = kind === 'text' ? this.card.textObjects : this.card.buttons;
    const i = list.findIndex((o) => o.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    if (this.selection?.id === id) this.selection = null;
    this.render();
    this.cb.onCommit?.();
    this.cb.onSelect?.(this.selection);
  }

  deleteSelected() {
    if (!this.selection) return false;
    this.removeObject(this.selection.kind, this.selection.id);
    return true;
  }
}
