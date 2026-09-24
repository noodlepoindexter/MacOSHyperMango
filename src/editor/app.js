/* ---------------------------------------------------------------------------
   Editor shell.

   Owns the model, routes pointer and keyboard input to the active tool, and
   keeps the sidebar, inspector, and status bar in sync. Everything with real
   logic lives in its own module; this file is the wiring.
   --------------------------------------------------------------------------- */

import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';

import {
  CARD_W, CARD_H, createStack, createCard, createButton, createText,
  uniqueCardName,
} from '../model/stack.js';
import { History } from '../model/history.js';
import { DocumentController } from '../model/document.js';
import { Surface } from '../canvas/surface.js';
import { ObjectLayer } from '../canvas/objects.js';
import { createTools, ToolContext } from '../canvas/tools/index.js';
import { ICONS, TOOL_META } from './icons.js';
import { Inspector } from './inspector.js';
import { CardBrowser } from './cardbrowser.js';
import { SwatchRail } from './palette.js';
import { openSheet, closeSheet, isSheetOpen, initSheets, row, input } from './sheet.js';
import { buildExportHtml } from '../export/html.js';
import { buildRuntimeBundle } from '../export/bundle.js';

/** How much a single magnifier click changes the zoom. */
const ZOOM_STEP = 1.35;

const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#d9d9d9', '#efefef', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
  '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
  '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#e8792b', '#2e9e5b', '#2f6fd0', '#8b3fc4',
];

class Editor {
  constructor() {
    this.stackData = createStack();
    this.cardIndex = 0;
    this.tool = 'pointer';
    this.style = { stroke: '#000000', fill: null, size: 3 };
    this.textStyle = { fontFamily: 'system-ui, sans-serif', fontSize: 20, color: '#000000' };
    this.pendingUndo = null;
    // Persisted so the split button remembers its last choice across
    // restarts, matching how a real split button behaves elsewhere.
    this.lastPlayMode = localStorage.getItem('hypermango:lastPlayMode') === 'fullscreen'
      ? 'fullscreen'
      : 'play';

    this.history = new History();
    this.doc = new DocumentController(this);

    this.surface = new Surface(document.getElementById('card-container'));
    this.tools = createTools();
    this.toolCtx = new ToolContext(this.surface, this.style, {
      pushUndo: () => this.pushUndo(),
      dropUndo: () => this.dropUndo(),
      commit: () => this.commit({ redrawObjects: false }),
    });

    this.objects = new ObjectLayer(
      document.getElementById('object-layer'),
      this.surface,
      {
        onSelect: (sel) => this.inspector.render(sel),
        onBeforeChange: () => this.pushUndo(),
        onCancelChange: () => this.dropUndo(),
        onCommit: () => this.commit(),
        onOpenScript: (kind, id) => this.openScriptSheet(kind, id),
      }
    );

    this.inspector = new Inspector(document.getElementById('inspector-body'), this);
    this.browser = new CardBrowser(document.getElementById('card-list'), this);
  }

  // --- facade used by inspector / browser ---------------------------------

  stack() { return this.stackData; }
  getStack() { return this.stackData; }
  currentIndex() { return this.cardIndex; }
  currentCard() { return this.stackData.cards[this.cardIndex]; }

  async setStack(next) {
    this.stackData = next;
    this.cardIndex = 0;
    this.history.clear();
    await this.showCard(0, { rebuild: true });
  }

  /** Flush the live canvas into the model before anything reads it. */
  async syncBeforeSave() {
    this.captureCard();
  }

  // --- boot ---------------------------------------------------------------

  async init() {
    initSheets();
    this.buildToolbar();
    this.bindToolbar();
    this.bindCanvas();
    this.bindKeyboard();
    this.bindMenu();
    this.bindWindow();
    this.bindScriptEditorSync();

    this.history.onChange = () => this.updateUndoButtons();

    await this.showCard(0, { rebuild: true });
    this.doc.syncTitle();

    // Open a file passed on the command line (Finder double-click).
    const args = new URLSearchParams(location.search);
    const path = args.get('open');
    if (path) await this.doc.loadPath(path);
  }

  buildToolbar() {
    const host = document.getElementById('tool-buttons');
    for (const [id, label, key] of TOOL_META) {
      if (id === 'sep') {
        const d = document.createElement('div');
        d.className = 'tool-sep';
        host.appendChild(d);
        continue;
      }
      const b = document.createElement('button');
      b.className = `tool-btn${id === this.tool ? ' active' : ''}`;
      b.id = `tool-${id}`;
      b.title = `${label} (${key})`;
      b.setAttribute('aria-label', label);
      b.innerHTML = ICONS[id];
      b.addEventListener('click', () => this.setTool(id));
      host.appendChild(b);
    }
  }

  bindToolbar() {
    const size = document.getElementById('brush-size');
    const readout = document.getElementById('size-readout');
    size.addEventListener('input', () => {
      this.style.size = parseInt(size.value, 10);
      readout.textContent = size.value;
    });

    document.getElementById('font-family').addEventListener('change', (e) => {
      this.textStyle.fontFamily = e.target.value;
      this.applyTextStyleToSelection();
    });
    document.getElementById('font-size').addEventListener('change', (e) => {
      this.textStyle.fontSize = Math.max(8, Math.min(144, parseInt(e.target.value, 10) || 20));
      e.target.value = this.textStyle.fontSize;
      this.applyTextStyleToSelection();
    });

    this.bindColorWell('stroke-well', 'stroke');
    this.bindColorWell('fill-well', 'fill');
    this.bindColorFlyout();
    this.swatchRail = new SwatchRail(document.getElementById('palette-rail'), (c, button) => {
      // Left click sets the line colour, unless the bucket is active — its
      // "paint" is the fill. Right click always sets the fill.
      const key = button === 'right' || this.tool === 'bucket' ? 'fill' : 'stroke';
      this.style[key] = c;
      this.refreshWells();
      if (key === 'stroke') this.applyTextStyleToSelection(c);
    });

    document.getElementById('undo-btn').addEventListener('click', () => this.undo());
    document.getElementById('redo-btn').addEventListener('click', () => this.redo());
    document.getElementById('add-card-btn').addEventListener('click', () => this.addCard());
    document.getElementById('add-button-btn').addEventListener('click', () => this.setTool('button'));
    this.bindPlaySplit();

    this.refreshWells();
  }

  /** A colour well opens a palette popover anchored beneath it, closing as
      soon as a colour is picked — it edits exactly one swatch. */
  bindColorWell(wellId, key) {
    const well = document.getElementById(wellId);
    well.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.palette-pop');
      existing?.remove();
      if (existing?.dataset.for === wellId) return; // clicking again closes it

      const pop = document.createElement('div');
      pop.className = 'palette-pop';
      pop.dataset.for = wellId;
      pop.appendChild(this.buildColorSection(key, () => pop.remove()));
      document.body.appendChild(pop);

      const r = well.getBoundingClientRect();
      pop.style.left = `${Math.min(r.left, window.innerWidth - 224)}px`;
      pop.style.top = `${r.bottom + 6}px`;

      this.armPopoverDismiss(pop);
    });
  }

  /**
   * Right-click anywhere in the workspace — the card or the surrounding
   * area — opens both colour pickers together, positioned beside the cursor.
   * Unlike a single well's popover this one stays open after a pick, since
   * setting stroke and fill together in one right-click is the point.
   */
  bindColorFlyout() {
    const pane = document.getElementById('canvas-pane');
    pane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openColorFlyout(e.clientX, e.clientY);
    });
  }

  openColorFlyout(clientX, clientY) {
    document.querySelector('.palette-pop')?.remove();

    const pop = document.createElement('div');
    pop.className = 'palette-pop';
    pop.dataset.for = 'context';
    pop.appendChild(this.buildColorSection('stroke'));
    const sep = document.createElement('div');
    sep.className = 'color-flyout-sep';
    pop.appendChild(sep);
    pop.appendChild(this.buildColorSection('fill'));

    // Appended off-screen-position (but still laid out) so its size can be
    // measured before it is placed, so it can be flipped to the cursor's
    // left when it would otherwise run off the right edge of the window.
    document.body.appendChild(pop);
    const { width, height } = pop.getBoundingClientRect();
    let left = clientX + 10;
    if (left + width > window.innerWidth - 8) left = clientX - width - 10;
    let top = Math.min(clientY - 8, window.innerHeight - height - 8);
    top = Math.max(8, top);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${top}px`;

    this.armPopoverDismiss(pop);
  }

  /**
   * The Play button is a split button: the main part invokes whichever mode
   * (windowed or fullscreen) was last chosen, and a chevron opens a menu to
   * choose between them. Picking an item both plays immediately and becomes
   * the new default, which is what makes it a *split* button rather than
   * just a button with a menu bolted on.
   */
  bindPlaySplit() {
    const mainBtn = document.getElementById('play-btn');
    const chevronBtn = document.getElementById('play-chevron-btn');

    this.applyPlayMode();
    mainBtn.addEventListener('click', () => this.play({ fullscreen: this.lastPlayMode === 'fullscreen' }));

    chevronBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.split-menu');
      existing?.remove();
      if (existing) return; // clicking the chevron again just closes it

      const menu = document.createElement('div');
      menu.className = 'split-menu';

      for (const [mode, label] of [['play', '▶ Play'], ['fullscreen', '⛶ Play Fullscreen']]) {
        const item = document.createElement('button');
        item.className = `split-menu-item${this.lastPlayMode === mode ? ' current' : ''}`;
        item.innerHTML = `<span class="check">✓</span>${label}`;
        item.addEventListener('click', () => {
          this.lastPlayMode = mode;
          localStorage.setItem('hypermango:lastPlayMode', mode);
          this.applyPlayMode();
          menu.remove();
          this.play({ fullscreen: mode === 'fullscreen' });
        });
        menu.appendChild(item);
      }

      document.body.appendChild(menu);
      const r = chevronBtn.getBoundingClientRect();
      const w = menu.getBoundingClientRect().width;
      menu.style.left = `${Math.min(r.right - w, window.innerWidth - w - 8)}px`;
      menu.style.top = `${r.bottom + 6}px`;

      this.armPopoverDismiss(menu);
    });
  }

  /** Reflect `lastPlayMode` on the split button's main label. */
  applyPlayMode() {
    document.getElementById('play-btn').textContent =
      this.lastPlayMode === 'fullscreen' ? '⛶ Play Fullscreen' : '▶ Play';
  }

  /** One colour section: swatch grid, custom picker, and a clear button.
      Shared by the toolbar wells' popovers and the right-click flyout so
      there is exactly one place that builds a colour picker. */
  buildColorSection(key, onPick) {
    const fallback = key === 'fill' ? null : '#000000';
    const wrap = document.createElement('div');

    const label = document.createElement('label');
    label.className = 'picker-label';
    label.textContent = key === 'fill' ? 'Fill' : 'Stroke';
    wrap.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'palette-grid';
    for (const c of PALETTE) {
      const sw = document.createElement('button');
      sw.className = `swatch${this.style[key] === c ? ' selected' : ''}`;
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        this.style[key] = c;
        this.refreshWells();
        this.applyTextStyleToSelection(c);
        onPick?.();
      });
      grid.appendChild(sw);
    }
    wrap.appendChild(grid);

    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = this.style[key] || fallback || '#000000';
    custom.addEventListener('input', () => {
      this.style[key] = custom.value;
      this.refreshWells();
    });
    wrap.appendChild(row('Custom', custom, true));

    const clear = document.createElement('button');
    clear.className = 'btn wide';
    clear.style.marginTop = 'var(--space-2)';
    clear.textContent = key === 'fill' ? 'No Fill' : 'No Stroke';
    clear.addEventListener('click', () => {
      this.style[key] = null;
      this.refreshWells();
      onPick?.();
    });
    wrap.appendChild(clear);

    return wrap;
  }

  /** Close a popover on the next left-click (or any pointerdown) outside it. */
  armPopoverDismiss(pop) {
    const dismiss = (ev) => {
      if (!pop.contains(ev.target)) {
        pop.remove();
        document.removeEventListener('pointerdown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
  }

  refreshWells() {
    for (const [id, key] of [['stroke-well', 'stroke'], ['fill-well', 'fill']]) {
      const el = document.getElementById(id);
      const v = this.style[key];
      el.classList.toggle('is-none', !v);
      el.style.setProperty('--well-color', v || 'transparent');
    }
    this.swatchRail?.highlight(this.style.stroke, this.style.fill);
  }

  /** Colour and font changes apply to a selected text object immediately. */
  applyTextStyleToSelection(colour) {
    const sel = this.objects.selection;
    if (sel?.kind !== 'text') return;
    const obj = this.objects.selected();
    if (!obj) return;
    obj.fontFamily = this.textStyle.fontFamily;
    obj.fontSize = this.textStyle.fontSize;
    if (colour) obj.color = colour;
    this.commit();
  }

  // --- tools --------------------------------------------------------------

  setTool(id) {
    // Leaving a multi-click tool mid-shape discards it.
    this.activeTool()?.onCancel?.(this.toolCtx);

    if (id === 'button') {
      this.addButton();
      return;
    }
    this.tool = id;
    document.querySelectorAll('.tool-btn[id^="tool-"]').forEach((b) => {
      b.classList.toggle('active', b.id === `tool-${id}`);
    });
    const meta = TOOL_META.find((m) => m[0] === id);
    document.getElementById('status-tool').textContent = meta ? meta[1] : id;

    const paintTool = this.tools[id];
    const cursor =
      id === 'text' ? 'text'
      : id === 'hand' ? 'grab'
      : id === 'zoom' ? 'zoom-in'
      : paintTool?.cursor || 'default';
    this.surface.overlay.style.cursor = cursor;
    document.getElementById('card-container').style.cursor = cursor;
    // Navigation tools work anywhere in the workspace, not just over the card.
    document.getElementById('canvas-pane').style.cursor =
      id === 'hand' ? 'grab' : id === 'zoom' ? 'zoom-in' : 'default';

    // Objects are only draggable with the pointer tool; drawing tools need
    // pointer events to reach the canvas underneath.
    this.objects.root.style.pointerEvents = id === 'pointer' ? 'auto' : 'none';
    if (id !== 'pointer') this.objects.deselect();
  }

  activeTool() {
    return this.tools[this.tool] || null;
  }

  // --- canvas input -------------------------------------------------------

  bindCanvas() {
    const container = document.getElementById('card-container');
    const pane = document.getElementById('canvas-pane');

    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      if (this.tool === 'pointer') {
        this.objects.deselect();
        return;
      }
      // 'hand' and 'zoom' are handled on the pane so they also work off-card.
      if (this.tool === 'hand' || this.tool === 'zoom') return;
      if (this.tool === 'text') {
        // Without this the browser's own focus handling for the pointerdown
        // lands after we focus the new field, blurring it — and an empty text
        // object is discarded on blur, so the object would vanish instantly.
        e.preventDefault();
        const p = this.surface.pointFrom(e, true);
        this.addText(p.x, p.y);
        return;
      }

      const tool = this.activeTool();
      if (!tool) return;

      // Drawing onto a canvas button targets that button's own surface. A
      // part-built multi-click shape keeps whatever target it started on, so a
      // polygon does not defect to the card halfway through.
      const p = this.surface.pointFrom(e, !tool.wantsRawPoints);
      if (!tool.isPending?.()) {
        this.toolCtx.target = this.canvasButtonTarget(p);
      }
      const pt = this.toolCtx.target ? this.toSurfacePoint(p, this.toolCtx.target) : p;

      container.setPointerCapture?.(e.pointerId);
      this.drawing = true;
      tool.onDown(this.toolCtx, pt, e);
    });

    container.addEventListener('pointermove', (e) => {
      const p = this.surface.pointFrom(e, true);
      document.getElementById('status-pos').textContent =
        `${Math.round(p.x)}, ${Math.round(p.y)}`;

      const tool = this.activeTool();
      if (!tool) return;
      // Multi-click tools track the cursor even when no button is held.
      if (!this.drawing && !tool.isMultiClick) return;
      const raw = tool.wantsRawPoints ? this.surface.pointFrom(e, false) : p;
      const pt = this.toolCtx.target ? this.toSurfacePoint(raw, this.toolCtx.target) : raw;
      tool.onMove(this.toolCtx, pt, e);
    });

    const finish = (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      const tool = this.activeTool();
      if (!tool) return;
      const p = this.surface.pointFrom(e, true);
      const pt = this.toolCtx.target ? this.toSurfacePoint(p, this.toolCtx.target) : p;
      tool.onUp(this.toolCtx, pt, e);
      // Hold the target until a multi-click shape actually commits.
      if (this.toolCtx.target && !tool.isPending?.()) {
        this.storeCanvasButton(this.toolCtx.target);
        this.toolCtx.target = null;
      }
    };
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);

    // A multi-click tool must keep receiving input when the pointer leaves the
    // card: the vertex is still meaningful, it just has to be clipped back to
    // the edge. Card-area events are handled above, so these listeners ignore
    // anything that already reached the container.
    const outside = (e) => !container.contains(e.target);

    window.addEventListener('pointerdown', (e) => {
      const tool = this.activeTool();
      if (e.button !== 0 || !tool?.isMultiClick || !outside(e)) return;
      // Clicks on the chrome (toolbar, inspector, sidebar) are real UI clicks.
      if (e.target.closest('#toolbar, #toolrail, #palette-rail, #optionsbar, #inspector, #sidebar, #statusbar, .sheet-backdrop, .palette-pop')) {
        return;
      }
      e.preventDefault();
      tool.onDown(this.toolCtx, this.surface.pointFrom(e, false), e);
      if (this.toolCtx.target && !tool.isPending?.()) {
        this.storeCanvasButton(this.toolCtx.target);
        this.toolCtx.target = null;
      }
    });

    window.addEventListener('pointermove', (e) => {
      const tool = this.activeTool();
      if (!tool?.isMultiClick || !outside(e)) return;
      tool.onMove(this.toolCtx, this.surface.pointFrom(e, false), e);
    });

    container.addEventListener('dblclick', (e) => {
      const tool = this.activeTool();
      if (!tool?.onDoubleClick) return;
      tool.onDoubleClick(this.toolCtx, this.surface.pointFrom(e, true), e);
      // Double-click is how a polygon finishes, so flush the target here too.
      if (this.toolCtx.target && !tool.isPending?.()) {
        this.storeCanvasButton(this.toolCtx.target);
        this.toolCtx.target = null;
      }
    });

    // Zoom follows the pane, and ⌘/Ctrl+wheel zooms.
    new ResizeObserver(() => {
      this.surface.applyZoom();
      this.updateZoomStatus();
    }).observe(pane);

    // Navigation input lives on the pane so it covers the whole workspace, not
    // just the card: middle-drag pans with any tool active, and the hand and
    // zoom tools work over the empty area around the card too.
    pane.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.startPan(e);
        return;
      }
      if (e.button !== 0) return;
      if (this.tool === 'hand') {
        e.preventDefault();
        this.startPan(e);
      } else if (this.tool === 'zoom') {
        e.preventDefault();
        // Option-click zooms out, matching the convention in drawing apps.
        this.surface.zoomAt(e.altKey ? 1 / ZOOM_STEP : ZOOM_STEP, e.clientX, e.clientY);
        this.updateZoomStatus();
      }
    });
    // Suppress the middle-click paste/auto-scroll affordance.
    pane.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    // The wheel zooms about the cursor. There is nothing to scroll — the card
    // is placed by transform — so no modifier is required.
    pane.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Exponential in the delta, so trackpads and notched wheels both feel
      // proportional rather than one being unusably fast.
      const factor = Math.pow(1.0015, -e.deltaY);
      this.surface.zoomAt(factor, e.clientX, e.clientY);
      this.updateZoomStatus();
    }, { passive: false });

    // A display change alters devicePixelRatio; rebuild the backing store.
    window.addEventListener('resize', () => this.surface.handleDprChange());
  }

  /**
   * Drag the card around the workspace. Used by the hand tool and by a middle
   * drag with any tool active.
   */
  startPan(e) {
    const pane = document.getElementById('canvas-pane');
    let lastX = e.clientX;
    let lastY = e.clientY;
    pane.classList.add('panning');
    pane.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      this.surface.panBy(ev.clientX - lastX, ev.clientY - lastY);
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      pane.classList.remove('panning');
      pane.releasePointerCapture?.(e.pointerId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The canvas button under a point, if a drawing tool should target it. */
  canvasButtonTarget(p) {
    const btn = this.objects.buttonAt(p);
    if (!btn || !btn.isCanvas) return null;
    const el = this.objects.root.querySelector(`[data-id="${btn.id}"] canvas`);
    if (!el) return null;
    const ctx = el.getContext('2d');
    ctx.setTransform(this.surface.dpr, 0, 0, this.surface.dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return { button: btn, canvas: el, ctx };
  }

  toSurfacePoint(p, target) {
    return { x: p.x - target.button.x, y: p.y - target.button.y };
  }

  storeCanvasButton(target) {
    target.button.canvasData = target.canvas.toDataURL('image/png');
    this.commit({ redrawObjects: false });
  }

  // --- cards --------------------------------------------------------------

  captureCard() {
    const card = this.currentCard();
    if (card) card.imageData = this.surface.toDataURL();
  }

  async showCard(index, { rebuild = false } = {}) {
    const cards = this.stackData.cards;
    this.cardIndex = Math.max(0, Math.min(cards.length - 1, index));
    const card = cards[this.cardIndex];

    await this.surface.loadImage(card.imageData);
    this.objects.setCard(card);
    this.inspector.render(null);

    if (rebuild) this.browser.render();
    else this.browser.setActive(this.cardIndex);

    this.surface.applyZoom();
    this.updateStatus();
    this.updateUndoButtons();
  }

  async goToCard(index) {
    if (index === this.cardIndex) return;
    this.captureCard();
    this.browser.paint(this.currentCard());
    await this.showCard(index);
  }

  async addCard() {
    this.captureCard();
    const card = createCard();
    card.name = uniqueCardName(this.stackData.cards, card.name);
    this.stackData.cards.splice(this.cardIndex + 1, 0, card);
    this.doc.markDirty();
    await this.showCard(this.cardIndex + 1, { rebuild: true });
  }

  async deleteCurrentCard() {
    if (this.stackData.cards.length === 1) {
      this.flash('A stack needs at least one card', true);
      return;
    }
    const card = this.currentCard();
    this.history.forget(card.id);
    this.stackData.cards.splice(this.cardIndex, 1);
    this.doc.markDirty();
    await this.showCard(Math.min(this.cardIndex, this.stackData.cards.length - 1), {
      rebuild: true,
    });
  }

  renameCard(card, name) {
    if (!name) return card.name;
    const index = this.stackData.cards.indexOf(card);
    card.name = uniqueCardName(this.stackData.cards, name, index);
    this.doc.markDirty();
    this.browser.render();
    return card.name;
  }

  clearCardDrawing() {
    this.pushUndo();
    this.surface.clearPaint();
    this.commit({ redrawObjects: false });
  }

  // --- objects ------------------------------------------------------------

  addButton() {
    const card = this.currentCard();
    this.pushUndo();
    const btn = createButton(this.cardIndex, card.buttons.length);
    card.buttons.push(btn);
    this.setTool('pointer');
    this.commit();
    this.objects.select('button', btn.id);
  }

  addText(x, y) {
    const card = this.currentCard();
    this.pushUndo();
    const obj = createText(Math.round(x), Math.round(y), {
      ...this.textStyle,
      color: this.style.stroke || '#000000',
    });
    card.textObjects.push(obj);
    this.setTool('pointer');
    this.commit();
    this.objects.select('text', obj.id);
    // Drop straight into typing — a text object with no content is useless.
    // Deferred a frame so focus lands after the placing pointer event has
    // finished being dispatched.
    requestAnimationFrame(() => {
      const el = this.objects.root.querySelector(`[data-id="${obj.id}"]`);
      if (el) this.objects.startEdit(obj, el);
    });
  }

  deleteSelectedObject() {
    this.pushUndo();
    if (!this.objects.deleteSelected()) this.dropUndo();
  }

  uniqueButtonName(button, name) {
    if (!name) return button.nameId;
    const taken = new Set(
      this.stackData.cards
        .flatMap((c) => c.buttons)
        .filter((b) => b !== button)
        .map((b) => b.nameId)
    );
    if (!taken.has(name)) return name;
    let i = 2;
    while (taken.has(`${name}_${i}`)) i++;
    return `${name}_${i}`;
  }

  // --- undo ---------------------------------------------------------------

  /**
   * Capture the current card before a mutation. The paint layer is stored as a
   * PNG data URL rather than a Blob: capture has to be synchronous (tools call
   * this immediately before drawing) and PNG keeps a 40-deep stack to a few MB
   * where raw bitmaps would be well over a hundred.
   */
  pushUndo() {
    const card = this.currentCard();
    if (!card) return;
    this.pendingUndo = card.id;
    this.history.push(card.id, this.snapshot(card));
  }

  /** Undo a `pushUndo` for an edit that turned out to be a no-op. */
  dropUndo() {
    if (!this.pendingUndo) return;
    const s = this.history.stackFor(this.pendingUndo);
    s.undo.pop();
    this.pendingUndo = null;
    this.updateUndoButtons();
  }

  snapshot(card) {
    return {
      paint: this.surface.toDataURL(),
      texts: JSON.parse(JSON.stringify(card.textObjects)),
      buttons: JSON.parse(JSON.stringify(card.buttons)),
    };
  }

  async applySnapshot(card, snap) {
    await this.surface.loadImage(snap.paint);
    card.textObjects = snap.texts;
    card.buttons = snap.buttons;
    card.imageData = snap.paint;
    this.objects.setCard(card);
    this.inspector.render(null);
    this.browser.paint(card);
    this.doc.markDirty();
    this.updateUndoButtons();
  }

  async undo() {
    const card = this.currentCard();
    const state = this.history.undo(card.id, this.snapshot(card));
    if (state) await this.applySnapshot(card, state);
  }

  async redo() {
    const card = this.currentCard();
    const state = this.history.redo(card.id, this.snapshot(card));
    if (state) await this.applySnapshot(card, state);
  }

  updateUndoButtons() {
    const card = this.currentCard();
    if (!card) return;
    document.getElementById('undo-btn').disabled = !this.history.canUndo(card.id);
    document.getElementById('redo-btn').disabled = !this.history.canRedo(card.id);
  }

  /** Persist the live canvas into the model and refresh dependent views. */
  commit({ redrawObjects = true } = {}) {
    this.pendingUndo = null;
    this.captureCard();
    if (redrawObjects) this.objects.render();
    this.browser.paint(this.currentCard());
    this.doc.markDirty();
    this.updateUndoButtons();
  }

  // --- status -------------------------------------------------------------

  /** Collapse or restore a pane, re-fitting the card to the new pane size. */
  togglePane(cls) {
    document.getElementById('app').classList.toggle(cls);
    // The pane changed size, so the fit is stale.
    requestAnimationFrame(() => {
      this.surface.applyZoom();
      this.updateZoomStatus();
    });
  }

  updateStatus() {
    document.getElementById('status-card').textContent =
      `${this.cardIndex + 1} / ${this.stackData.cards.length}`;
    this.updateZoomStatus();
  }

  updateZoomStatus() {
    document.getElementById('status-zoom').textContent =
      `${Math.round(this.surface.zoom * 100)}%`;
  }

  flash(message, isError = false) {
    const bar = document.getElementById('msg-bar');
    bar.textContent = message;
    bar.className = `visible ${isError ? 'error' : 'info'}`;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      bar.className = '';
    }, 4000);
  }

  // --- sheets -------------------------------------------------------------

  /**
   * Find a card or button by id, searching the whole stack rather than just
   * the current card. A script-editor window can stay open while the main
   * window navigates to a different card, so "current card" is not a safe
   * assumption by the time a save comes back.
   */
  findScriptTarget(kind, id) {
    if (kind === 'card') {
      return this.stackData.cards.find((c) => c.id === id) || null;
    }
    for (const card of this.stackData.cards) {
      const btn = card.buttons.find((b) => b.id === id);
      if (btn) return btn;
    }
    return null;
  }

  /**
   * Open a script in its own real window — native titlebar, traffic lights,
   * draggable and independently closable — rather than the in-app sheet this
   * used to be. One window per object being edited (labelled by kind+id), so
   * editing several scripts side by side works and reopening one that is
   * already open just brings it forward instead of duplicating it.
   */
  async openScriptSheet(kind, id) {
    const obj = this.findScriptTarget(kind, id);
    if (!obj) return;

    const label = `script_${kind}_${sanitizeWindowLabel(id)}`;
    const title =
      kind === 'card' ? `Card Script — ${obj.name}` : `Button Script — ${obj.nameId}`;

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }

    // The new window is a separate webview with no access to this window's
    // JS state, so the script text is handed over via localStorage — keyed
    // by the new window's own label, mirroring how Play mode hands over the
    // whole stack — and read once by that window as it boots.
    localStorage.setItem(
      `hypermango:script:${label}`,
      JSON.stringify({ kind, id, script: obj.script || '' })
    );

    const win = new WebviewWindow(label, {
      url: `script-editor.html?w=${encodeURIComponent(label)}`,
      title,
      width: 720,
      height: 560,
      minWidth: 480,
      minHeight: 360,
      resizable: true,
    });
    win.once('tauri://error', (e) =>
      this.flash(`Could not open the script editor: ${e}`, true)
    );
  }

  /** Apply a script saved from a script-editor window back into the model. */
  bindScriptEditorSync() {
    listen('script-editor:save', (event) => {
      const { kind, id, script } = event.payload;
      const obj = this.findScriptTarget(kind, id);
      if (!obj) return;
      obj.script = script;
      this.commit({ redrawObjects: false });
      this.inspector.render(this.objects.selection);
    });
  }

  /**
   * Open the script reference in its own window rather than the shared sheet.
   * That sheet is a single set of DOM nodes reused for every dialog, so
   * opening the reference from inside the script editor used to blow away the
   * script-editing sheet underneath it. A separate window also matches what
   * was asked for directly: something that can sit above the script editor
   * without taking its place, and that comes forward rather than duplicating
   * if it's already open.
   */
  async openReference() {
    const existing = await WebviewWindow.getByLabel('reference');
    if (existing) {
      await existing.setFocus();
      return;
    }
    const win = new WebviewWindow('reference', {
      url: 'reference.html',
      title: 'Script Reference',
      width: 460,
      height: 720,
      minWidth: 360,
      minHeight: 420,
      resizable: true,
    });
    win.once('tauri://error', (e) => this.flash(`Could not open the reference window: ${e}`, true));
  }

  openVariables() {
    const body = document.createElement('div');
    const list = document.createElement('div');
    body.appendChild(list);

    const intro = document.createElement('p');
    intro.textContent =
      'Starting values for the whole stack. Variables reset each time Play mode begins.';
    body.insertBefore(intro, list);

    const draw = () => {
      list.innerHTML = '';
      const entries = Object.entries(this.stackData.variables);
      if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'No variables yet.';
        list.appendChild(empty);
      }
      for (const [name, value] of entries) {
        const r = document.createElement('div');
        r.className = 'var-row';
        const n = input('text', name);
        n.className = 'name';
        n.addEventListener('change', () => {
          const next = n.value.trim();
          if (!/^[A-Za-z_]\w*$/.test(next)) {
            n.value = name;
            this.flash('Variable names use letters, digits, and underscores', true);
            return;
          }
          if (next !== name) {
            delete this.stackData.variables[name];
            this.stackData.variables[next] = value;
            this.doc.markDirty();
            draw();
          }
        });
        const v = input('text', String(value));
        v.addEventListener('change', () => {
          const raw = v.value.trim();
          const num = Number(raw);
          this.stackData.variables[n.value.trim()] =
            raw !== '' && !Number.isNaN(num) ? num : raw;
          this.doc.markDirty();
        });
        const del = document.createElement('button');
        del.className = 'btn danger';
        del.textContent = '✕';
        del.addEventListener('click', () => {
          delete this.stackData.variables[name];
          this.doc.markDirty();
          draw();
        });
        r.append(n, v, del);
        list.appendChild(r);
      }

      const add = document.createElement('button');
      add.className = 'btn wide';
      add.textContent = '+ Add Variable';
      add.addEventListener('click', () => {
        let i = 1;
        while (this.stackData.variables[`var_${i}`] !== undefined) i++;
        this.stackData.variables[`var_${i}`] = 0;
        this.doc.markDirty();
        draw();
      });
      list.appendChild(add);
    };
    draw();

    openSheet({
      title: 'Variables',
      body,
      width: '460px',
      buttons: [{ label: 'Done', kind: 'primary' }],
    });
  }

  renameProject() {
    const field = input('text', this.stackData.projectName, { maxlength: '60' });
    openSheet({
      title: 'Rename Project',
      body: row('Project name', field),
      width: '380px',
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Rename',
          kind: 'primary',
          action: () => {
            const v = field.value.trim();
            if (!v) return false;
            this.stackData.projectName = v;
            this.doc.markDirty();
            this.doc.syncTitle();
          },
        },
      ],
    });
  }

  // --- play ---------------------------------------------------------------

  /**
   * @param {object} opts
   *   fullscreen  put the play window into native fullscreen after opening —
   *               the same call `setFullscreen(true)` that the window's own
   *               green traffic-light button makes, so it is exactly what
   *               pressing that button would do, not a separate custom mode.
   *               macOS has nothing "more full" than that for a normal
   *               window: it already takes the dedicated fullscreen Space,
   *               hiding the menu bar and Dock. A borderless window sized to
   *               the screen would skip that Spaces integration rather than
   *               add anything to it, so this deliberately doesn't add one.
   */
  async play({ fullscreen = false } = {}) {
    this.captureCard();
    // The player reads the stack from localStorage rather than receiving it
    // over IPC: stacks carry base64 images and can be many megabytes.
    // It must be localStorage, not sessionStorage — the play window is a
    // separate webview, and sessionStorage is scoped per browsing context.
    localStorage.setItem(
      'hypermango:play',
      JSON.stringify({
        stack: this.stackData,
        startIndex: this.cardIndex,
      })
    );

    const existing = await WebviewWindow.getByLabel('play');
    if (existing) {
      await existing.setFocus();
      await existing.emit('play:restart');
      if (fullscreen) await existing.setFullscreen(true);
      return;
    }
    const win = new WebviewWindow('play', {
      url: 'play.html',
      title: `${this.stackData.projectName} — Play`,
      width: 1100,
      height: 850,
      resizable: true,
    });
    win.once('tauri://error', (e) => this.flash(`Could not open Play window: ${e}`, true));
    // setFullscreen has to wait for the window to actually exist rather than
    // firing right after construction — 'tauri://created' is the documented
    // signal for that, unlike 'tauri://error' which only ever fires on failure.
    if (fullscreen) {
      win.once('tauri://created', () => {
        win.setFullscreen(true);
      });
    }
  }

  // --- clipboard ----------------------------------------------------------

  async pasteImage() {
    try {
      const image = await readImage();
      const bytes = await image.rgba();
      const size = await image.size();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
      void blob;

      // rgba() gives raw pixels; wrap them in ImageData to draw.
      const data = new ImageData(
        new Uint8ClampedArray(bytes),
        size.width,
        size.height
      );
      const tmp = document.createElement('canvas');
      tmp.width = size.width;
      tmp.height = size.height;
      tmp.getContext('2d').putImageData(data, 0, 0);

      this.pushUndo();
      // Fit the pasted image inside the card, centred, without upscaling.
      const scale = Math.min(1, CARD_W / size.width, CARD_H / size.height);
      const w = size.width * scale;
      const h = size.height * scale;
      this.surface.ctx.drawImage(tmp, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
      this.commit({ redrawObjects: false });
      this.flash('Image pasted');
    } catch {
      this.flash('No image on the clipboard', true);
    }
  }

  // --- input --------------------------------------------------------------

  bindKeyboard() {
    const SHORTCUTS = {
      v: 'pointer', p: 'pencil', e: 'eraser', r: 'rect', c: 'ellipse',
      f: 'fillRect', b: 'bucket', l: 'lasso', g: 'polygon', t: 'text',
      h: 'hand', z: 'zoom',
    };

    document.addEventListener('keydown', (e) => {
      if (isSheetOpen()) return;
      // Never steal keys from a field the user is typing in.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'v') {
          e.preventDefault();
          this.pasteImage();
        }
        return; // everything else with a modifier belongs to the native menu
      }

      if (e.key === 'Escape') {
        this.activeTool()?.onCancel?.(this.toolCtx);
        this.objects.deselect();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.objects.selection) {
          e.preventDefault();
          this.deleteSelectedObject();
        }
        return;
      }

      const tool = SHORTCUTS[e.key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        this.setTool(tool);
      }
    });
  }

  bindMenu() {
    const handlers = {
      'file.new': () => this.doc.newStack(),
      'file.open': () => this.doc.openStack(),
      'file.save': () => this.doc.save(),
      'file.saveAs': () => this.doc.saveAs(),
      'file.importHweb': () => this.doc.importHweb(),
      'file.exportHweb': () => this.doc.exportHweb(),
      'file.exportHtml': () =>
        this.doc.exportHtml((stack) => buildExportHtml(stack, buildRuntimeBundle())),
      'file.rename': () => this.renameProject(),

      'edit.undo': () => this.undo(),
      'edit.redo': () => this.redo(),
      'edit.clearCard': () => this.clearCardDrawing(),
      'edit.deleteCard': () => this.deleteCurrentCard(),
      'edit.renameCard': () => this.inspector.render(null),
      'edit.cardScript': () => this.openScriptSheet('card', this.currentCard().id),

      'card.add': () => this.addCard(),
      'card.addButton': () => this.addButton(),
      'card.addText': () => this.addText(80, 80),
      'card.first': () => this.goToCard(0),
      'card.prev': () => this.goToCard(this.cardIndex - 1),
      'card.next': () => this.goToCard(this.cardIndex + 1),
      'card.last': () => this.goToCard(this.stackData.cards.length - 1),

      'stack.play': () => this.play({ fullscreen: this.lastPlayMode === 'fullscreen' }),
      'stack.variables': () => this.openVariables(),
      'stack.reference': () => this.openReference(),

      'view.sidebar': () => this.togglePane('no-sidebar'),
      'view.inspector': () => this.togglePane('no-inspector'),
      'view.zoomIn': () => { this.surface.zoomBy(1.25); this.updateZoomStatus(); },
      'view.zoomOut': () => { this.surface.zoomBy(0.8); this.updateZoomStatus(); },
      'view.zoomActual': () => { this.surface.setZoom('actual'); this.updateZoomStatus(); },
      'view.zoomFit': () => { this.surface.setZoom('fit'); this.updateZoomStatus(); },
    };

    listen('menu', (event) => {
      const id = event.payload;
      if (id.startsWith('recent:')) this.doc.openRecent(id.slice('recent:'.length));
      else handlers[id]?.();
    });
  }

  bindWindow() {
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await this.doc.confirmDiscard())) event.preventDefault();
    });
  }
}

/** Tauri window labels are restricted to a safe charset; ids are already
    alnum/underscore in practice, but loaded .hweb files are not guaranteed
    to keep that, so this is defensive rather than decorative. */
function sanitizeWindowLabel(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

const editor = new Editor();
window.__editor = editor; // handy in the webview inspector
editor.init();
