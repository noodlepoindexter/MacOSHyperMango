/* ---------------------------------------------------------------------------
   Play mode.

   Runs in its own window so it can go full screen while the editor stays open
   behind it. Implements the interpreter's host interface and nothing more —
   all language behaviour lives in runtime/.
   --------------------------------------------------------------------------- */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { CARD_W, CARD_H, findCardIndex } from '../model/stack.js';
import { Interpreter } from '../runtime/interpreter.js';
import { AudioEngine } from '../runtime/audio.js';
import { triggerEffect } from '../runtime/effects.js';
import { openSheet, closeSheet, initSheets } from '../editor/sheet.js';

export class Player {
  /**
   * @param {object} opts
   *   root      element containing the canvas and object layer
   *   canvas    the card canvas
   *   objects   the object layer element
   *   stack     the stack model
   *   assetBase URL prefix for bundled sounds
   */
  constructor({ root, canvas, objects, stack, assetBase = '/audio/' }) {
    this.root = root;
    this.canvas = canvas;
    this.objectsEl = objects;
    this.stack = stack;
    this.ctx = canvas.getContext('2d');

    this.audio = new AudioEngine(stack.customSounds, assetBase);
    // Variables start from the stack's declared values each session.
    this.globals = { ...stack.variables, answer: '' };
    this.interp = new Interpreter(this, this.globals);

    this.index = 0;
    this.buttonState = new Map(); // nameId -> {el, visible}
    this.textState = new Map();   // id -> el

    // Voice/rate for `speak`, set by `speaker`. Null means "browser default".
    this.voiceName = null;
    this.speechRate = 1;
    // Chrome/Firefox populate the voice list asynchronously; touching it once
    // up front nudges that along so it's more likely ready by the time a
    // script actually speaks. WebKit (this app's own webview) already has it
    // synchronously, backed directly by the OS voice registry.
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

    this.setupCanvas();
  }

  setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(CARD_W * dpr);
    this.canvas.height = Math.round(CARD_H * dpr);
    this.canvas.style.width = `${CARD_W}px`;
    this.canvas.style.height = `${CARD_H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.root.style.width = `${CARD_W}px`;
    this.root.style.height = `${CARD_H}px`;
    this.objectsEl.style.width = `${CARD_W}px`;
    this.objectsEl.style.height = `${CARD_H}px`;
    this.fit();
  }

  /** Scale the card to fill the window without cropping. */
  fit() {
    const pad = 32;
    const scale = Math.min(
      (window.innerWidth - pad) / CARD_W,
      (window.innerHeight - pad) / CARD_H
    );
    this.root.style.transform = `scale(${Math.max(0.1, scale)})`;
  }

  async start(index = 0) {
    await this.show(index);
  }

  stop() {
    this.interp.cancel();
    this.audio.stopAll();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // --- rendering ----------------------------------------------------------

  async show(index) {
    const card = this.stack.cards[index];
    if (!card) return;
    this.index = index;

    // A pending script from the previous card must not touch this one.
    this.interp.cancel();

    await this.drawPaint(card);
    this.renderObjects(card);

    // The card's own script runs on entry.
    this.interp.cancelled = false;
    if (card.script?.trim()) await this.interp.run(card.script, null);
  }

  drawPaint(card) {
    return new Promise((resolve) => {
      this.ctx.clearRect(0, 0, CARD_W, CARD_H);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, CARD_W, CARD_H);
      if (!card.imageData) {
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = card.imageData;
    });
  }

  renderObjects(card) {
    this.objectsEl.innerHTML = '';
    this.buttonState.clear();
    this.textState.clear();

    for (const t of card.textObjects) {
      const el = document.createElement('div');
      el.className = 'obj obj-text';
      Object.assign(el.style, {
        left: `${t.x}px`, top: `${t.y}px`,
        width: `${t.w}px`, height: `${t.h}px`,
        fontFamily: t.fontFamily, fontSize: `${t.fontSize}px`, color: t.color,
      });
      el.textContent = t.content;
      this.objectsEl.appendChild(el);
      this.textState.set(t.id, el);
    }

    for (const b of card.buttons) {
      const el = document.createElement('div');
      el.className = `obj obj-button${b.invisible ? ' invisible' : ''}${b.isCanvas ? ' is-canvas' : ''}`;
      Object.assign(el.style, {
        left: `${b.x}px`, top: `${b.y}px`,
        width: `${b.w}px`, height: `${b.h}px`,
      });

      if (b.isCanvas && b.canvasData) {
        const img = document.createElement('img');
        img.src = b.canvasData;
        img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
        el.appendChild(img);
      } else if (!b.isCanvas) {
        const label = document.createElement('span');
        label.className = 'obj-button-label';
        label.textContent = b.label;
        el.appendChild(label);
      }

      el.addEventListener('click', () => this.activate(b));
      this.objectsEl.appendChild(el);
      this.buttonState.set(b.nameId, { el, visible: true });
    }
  }

  /** Run a button's behaviour: a script if it has one, otherwise the simple
      sound / effect / go-to properties. */
  async activate(button) {
    if (button.effect) triggerEffect(this.root, button.effect);

    if (button.script?.trim()) {
      this.interp.cancelled = false;
      await this.interp.run(button.script, button.nameId);
      return;
    }
    if (button.sound) this.audio.play(button.sound);
    if (button.goto > 0 && button.goto <= this.stack.cards.length) {
      await this.show(button.goto - 1);
    }
  }

  // --- interpreter host ---------------------------------------------------

  async goCard(target) {
    let next;
    if (target.kind === 'next') next = Math.min(this.index + 1, this.stack.cards.length - 1);
    else if (target.kind === 'prev') next = Math.max(this.index - 1, 0);
    else if (target.kind === 'first') next = 0;
    else if (target.kind === 'last') next = this.stack.cards.length - 1;
    else {
      next = findCardIndex(this.stack.cards, target);
      if (next < 0) {
        this.reportError(`No card named '${target.value}'`);
        return;
      }
    }
    await this.show(next);
  }

  playSound(name) {
    return this.audio.play(name);
  }

  waitForSounds() {
    return this.audio.waitForAll();
  }

  showButton(id) {
    const s = this.buttonState.get(id);
    if (!s) {
      this.reportError(`No button named '${id}'`);
      return;
    }
    s.visible = true;
    s.el.style.visibility = 'visible';
    s.el.style.pointerEvents = 'auto';
  }

  hideButton(id) {
    const s = this.buttonState.get(id);
    if (!s) {
      this.reportError(`No button named '${id}'`);
      return;
    }
    s.visible = false;
    s.el.style.visibility = 'hidden';
    s.el.style.pointerEvents = 'none';
  }

  isButtonVisible(id) {
    return this.buttonState.get(id)?.visible ?? false;
  }

  moveButton(id, direction, amount, isPercent, seconds) {
    const s = this.buttonState.get(id);
    if (!s) {
      this.reportError(`No button named '${id}'`);
      return Promise.resolve();
    }
    const el = s.el;
    // A percentage is relative to the button's own size, matching the original.
    const base = direction === 'left' || direction === 'right' ? el.offsetWidth : el.offsetHeight;
    const distance = isPercent ? (amount / 100) * base : amount;

    const dx = direction === 'left' ? -distance : direction === 'right' ? distance : 0;
    const dy = direction === 'up' ? -distance : direction === 'down' ? distance : 0;

    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    const ms = Math.max(0, seconds) * 1000;

    if (ms <= 0) {
      el.style.left = `${startLeft + dx}px`;
      el.style.top = `${startTop + dy}px`;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min((now - t0) / ms, 1);
        // Quadratic ease-in-out, carried over from the web version.
        const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        el.style.left = `${startLeft + dx * e}px`;
        el.style.top = `${startTop + dy * e}px`;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  triggerEffect(name) {
    return triggerEffect(this.root, name);
  }

  getText(name) {
    const el = this.textState.get(name);
    return el ? el.textContent : null;
  }

  setText(name, value) {
    const el = this.textState.get(name);
    if (!el) return false;
    el.textContent = value;
    return true;
  }

  currentCardName() {
    return this.stack.cards[this.index]?.name ?? '';
  }

  currentCardNumber() {
    return this.index + 1;
  }

  reportError(message) {
    this.message(message, true);
  }

  message(text, isError = false) {
    const bar = document.getElementById('play-msg');
    if (!bar) return;
    bar.textContent = text;
    bar.className = `visible ${isError ? 'error' : 'info'}`;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => {
      bar.className = '';
    }, 5000);
  }

  // --- dialogs ------------------------------------------------------------

  ask(prompt) {
    return new Promise((resolve) => {
      const field = document.createElement('input');
      field.type = 'text';
      field.autocomplete = 'off';

      const body = document.createElement('div');
      const p = document.createElement('p');
      p.textContent = prompt;
      body.append(p, field);

      let answered = false;
      const finish = () => {
        if (answered) return;
        answered = true;
        resolve(field.value);
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
          closeSheet();
        }
      });
      openSheet({
        title: 'Input',
        body,
        width: '420px',
        buttons: [{ label: 'OK', kind: 'primary', action: finish }],
        onClose: finish,
      });
    });
  }

  say(prompt) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      openSheet({
        title: 'Message',
        body: `<p>${escapeHtml(prompt)}</p>`,
        width: '420px',
        buttons: [{ label: 'OK', kind: 'primary', action: finish }],
        onClose: finish,
      });
    });
  }

  yesno(prompt) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      openSheet({
        title: 'Question',
        body: `<p>${escapeHtml(prompt)}</p>`,
        width: '420px',
        buttons: [
          { label: 'No', action: () => finish(0) },
          { label: 'Yes', kind: 'primary', action: () => finish(1) },
        ],
        // Dismissing without choosing counts as No, so scripts never hang.
        onClose: () => finish(0),
      });
    });
  }

  /**
   * Speak text aloud via the browser's Web Speech API. This runs in the
   * webview itself rather than shelling out to a platform TTS binary, which
   * is what lets the very same host method work in the exported HTML page
   * too (see export/html.js) with no native code or extra capability grants.
   */
  speak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = this.speechRate;
      const voice = findVoice(this.voiceName);
      if (voice) utter.voice = voice;
      utter.onend = resolve;
      utter.onerror = resolve;
      window.speechSynthesis.speak(utter);
    });
  }

  /** Host method for the `speaker` command — either argument may be null. */
  setVoice(name, rate) {
    if (name) this.voiceName = name;
    if (rate !== null && rate !== undefined) this.speechRate = wpmToRate(rate);
    return Promise.resolve();
  }
}

/**
 * `say -r <n>` counts words per minute; the Web Speech API's `rate` is a
 * unitless multiplier around 1.0 with no defined unit at all. ~175 wpm is
 * the traditional default for `say`, so it's used here as the baseline that
 * maps to rate 1.0. This is necessarily an approximation — there's no true
 * words-per-minute control in the Web Speech API — but it scales in the
 * right direction, which is what a script author asking to go faster or
 * slower actually needs.
 */
function wpmToRate(wpm) {
  return Math.max(0.1, Math.min(10, wpm / 175));
}

/** Case-insensitive voice lookup, so `speaker zarvox` finds "Zarvox". */
function findVoice(name) {
  if (!name || !('speechSynthesis' in window)) return null;
  const target = name.toLowerCase();
  return window.speechSynthesis.getVoices().find((v) => v.name.toLowerCase() === target) || null;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- window bootstrap -------------------------------------------------------

async function boot() {
  initSheets();

  const raw = localStorage.getItem('hypermango:play');
  if (!raw) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:system-ui">Nothing to play.</p>';
    return;
  }
  const { stack, startIndex } = JSON.parse(raw);

  const player = new Player({
    root: document.getElementById('play-card'),
    canvas: document.getElementById('play-canvas'),
    objects: document.getElementById('play-objects'),
    stack,
  });

  window.addEventListener('resize', () => player.fit());

  let closing = false;
  document.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape' || closing) return;
    // Auto-repeat fires this handler many times while a key is held; the
    // guard above stops a second Escape from racing the first close.
    e.preventDefault();

    const win = getCurrentWindow();
    try {
      // Closing an NSWindow while it is mid-transition out of native macOS
      // fullscreen is what was taking down the whole app rather than just
      // this window — WKWebView/AppKit can abort the process on a close
      // during that animation. Exiting fullscreen first and giving it a
      // moment to settle avoids the race; only then is it safe to close.
      if (await win.isFullscreen()) {
        closing = true;
        await win.setFullscreen(false);
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch {
      // isFullscreen/setFullscreen are unavailable outside macOS builds —
      // fall through to a normal close.
    }

    closing = true;
    player.stop();
    // Bring the editor forward explicitly rather than relying on the OS to
    // pick a next-frontmost window after this one closes.
    const main = await WebviewWindow.getByLabel('main');
    await win.close();
    await main?.setFocus();
  });
  getCurrentWindow().listen('play:restart', async () => {
    const next = JSON.parse(localStorage.getItem('hypermango:play'));
    player.stack = next.stack;
    player.globals = { ...next.stack.variables, answer: '' };
    player.interp = new Interpreter(player, player.globals);
    player.audio.setCustomSounds(next.stack.customSounds);
    await player.start(next.startIndex ?? 0);
  });

  await player.start(startIndex ?? 0);
}

if (typeof document !== 'undefined' && document.getElementById('play-card')) boot();
