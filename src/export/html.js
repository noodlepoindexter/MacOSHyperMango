/* ---------------------------------------------------------------------------
   Standalone HTML export.

   Produces a single self-contained page that plays the stack with no app and
   no network: card paint layers and custom sounds are inlined as data URLs, and
   the scripting engine is the real runtime (see bundle.js).

   Bundled sample sounds are the one thing that cannot be inlined without
   bloating every export by several megabytes, so an exported page falls back to
   silence for them and says so in the export summary.
   --------------------------------------------------------------------------- */

import { CARD_W, CARD_H } from '../model/stack.js';

/**
 * Render a stack as a self-contained page.
 *
 * The runtime bundle is injected rather than imported so this module stays
 * free of build-tool syntax: the app passes the Vite-sourced bundle, and tests
 * pass one assembled straight from the runtime sources in Node.
 *
 * @param {object} stack
 * @param {string} runtimeBundle  the concatenated runtime, see bundle.js
 */
export function buildExportHtml(stack, runtimeBundle) {
  const payload = {
    projectName: stack.projectName,
    variables: stack.variables,
    customSounds: stack.customSounds,
    cards: stack.cards.map((c) => ({
      name: c.name,
      script: c.script || '',
      imageData: c.imageData,
      textObjects: c.textObjects,
      buttons: c.buttons,
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(stack.projectName)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<div id="stage">
  <div id="card">
    <canvas id="paint" width="${CARD_W}" height="${CARD_H}"></canvas>
    <div id="objects"></div>
  </div>
</div>
<div id="msg"></div>
<div id="dialog-backdrop">
  <div id="dialog">
    <div id="dialog-title"></div>
    <div id="dialog-body"></div>
    <div id="dialog-foot"></div>
  </div>
</div>
<script id="stack-data" type="application/json">${escapeJson(JSON.stringify(payload))}</script>
<script>
${runtimeBundle}
${PLAYER_SOURCE}
</script>
</body>
</html>`;
}

/* The exported page's player. Written as a string rather than a module because
   it must run as a classic script alongside the inlined runtime. It implements
   the same host interface the in-app player does. */
const PLAYER_SOURCE = String.raw`
/* --- exported player --- */
(function () {
  var CARD_W = ${CARD_W}, CARD_H = ${CARD_H};
  var data = JSON.parse(document.getElementById('stack-data').textContent);

  var cardEl = document.getElementById('card');
  var canvas = document.getElementById('paint');
  var objectsEl = document.getElementById('objects');
  var ctx = canvas.getContext('2d');

  cardEl.style.width = CARD_W + 'px';
  cardEl.style.height = CARD_H + 'px';

  function fit() {
    var s = Math.min((innerWidth - 32) / CARD_W, (innerHeight - 32) / CARD_H);
    cardEl.style.transform = 'scale(' + Math.max(0.1, s) + ')';
  }
  addEventListener('resize', fit);
  fit();

  function wpmToRate(wpm) {
    return Math.max(0.1, Math.min(10, wpm / 175));
  }
  function findVoice(name) {
    if (!name || !('speechSynthesis' in window)) return null;
    var target = name.toLowerCase();
    var voices = window.speechSynthesis.getVoices();
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name.toLowerCase() === target) return voices[i];
    }
    return null;
  }

  function Player() {
    this.index = 0;
    this.buttons = new Map();
    this.texts = new Map();
    // Bundled samples are not inlined, so only custom sounds resolve to audio.
    this.audio = new AudioEngine(data.customSounds || {}, '');
    this.globals = Object.assign({}, data.variables, { answer: '' });
    this.interp = new Interpreter(this, this.globals);
    this.voiceName = null;
    this.speechRate = 1;
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }

  Player.prototype.show = function (i) {
    var self = this;
    var card = data.cards[i];
    if (!card) return Promise.resolve();
    self.index = i;
    self.interp.cancel();

    return new Promise(function (resolve) {
      ctx.clearRect(0, 0, CARD_W, CARD_H);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CARD_W, CARD_H);
      if (!card.imageData) return resolve();
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, CARD_W, CARD_H); resolve(); };
      img.onerror = function () { resolve(); };
      img.src = card.imageData;
    }).then(function () {
      self.render(card);
      self.interp.cancelled = false;
      if (card.script && card.script.trim()) return self.interp.run(card.script, null);
    });
  };

  Player.prototype.render = function (card) {
    var self = this;
    objectsEl.innerHTML = '';
    self.buttons.clear();
    self.texts.clear();

    (card.textObjects || []).forEach(function (t) {
      var el = document.createElement('div');
      el.className = 'obj obj-text';
      el.style.cssText = 'left:' + t.x + 'px;top:' + t.y + 'px;width:' + t.w +
        'px;height:' + t.h + 'px;font-family:' + t.fontFamily +
        ';font-size:' + t.fontSize + 'px;color:' + t.color;
      el.textContent = t.content;
      objectsEl.appendChild(el);
      self.texts.set(t.id, el);
    });

    (card.buttons || []).forEach(function (b) {
      var el = document.createElement('div');
      el.className = 'obj obj-button' + (b.invisible ? ' invisible' : '') +
        (b.isCanvas ? ' is-canvas' : '');
      el.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w +
        'px;height:' + b.h + 'px';
      if (b.isCanvas && b.canvasData) {
        var img = document.createElement('img');
        img.src = b.canvasData;
        el.appendChild(img);
      } else if (!b.isCanvas) {
        var label = document.createElement('span');
        label.textContent = b.label;
        el.appendChild(label);
      }
      el.addEventListener('click', function () { self.activate(b); });
      objectsEl.appendChild(el);
      self.buttons.set(b.nameId, { el: el, visible: true });
    });
  };

  Player.prototype.activate = function (b) {
    var self = this;
    if (b.effect) triggerEffect(cardEl, b.effect);
    if (b.script && b.script.trim()) {
      self.interp.cancelled = false;
      return self.interp.run(b.script, b.nameId);
    }
    if (b.sound) self.audio.play(b.sound);
    if (b.goto > 0 && b.goto <= data.cards.length) return self.show(b.goto - 1);
  };

  /* --- interpreter host --- */

  Player.prototype.goCard = function (t) {
    var n;
    if (t.kind === 'next') n = Math.min(this.index + 1, data.cards.length - 1);
    else if (t.kind === 'prev') n = Math.max(this.index - 1, 0);
    else if (t.kind === 'first') n = 0;
    else if (t.kind === 'last') n = data.cards.length - 1;
    else if (t.kind === 'number') n = t.value - 1;
    else {
      n = data.cards.findIndex(function (c) { return c.name === t.value; });
      if (n < 0) { var p = parseInt(t.value, 10); n = isNaN(p) ? -1 : p - 1; }
    }
    if (n < 0 || n >= data.cards.length) { this.reportError("No card '" + t.value + "'"); return; }
    return this.show(n);
  };
  Player.prototype.playSound = function (n) { return this.audio.play(n); };
  Player.prototype.waitForSounds = function () { return this.audio.waitForAll(); };
  Player.prototype.showButton = function (id) {
    var s = this.buttons.get(id);
    if (!s) return this.reportError("No button '" + id + "'");
    s.visible = true; s.el.style.visibility = 'visible'; s.el.style.pointerEvents = 'auto';
  };
  Player.prototype.hideButton = function (id) {
    var s = this.buttons.get(id);
    if (!s) return this.reportError("No button '" + id + "'");
    s.visible = false; s.el.style.visibility = 'hidden'; s.el.style.pointerEvents = 'none';
  };
  Player.prototype.isButtonVisible = function (id) {
    var s = this.buttons.get(id); return s ? s.visible : false;
  };
  Player.prototype.moveButton = function (id, dir, amount, isPercent, secs) {
    var s = this.buttons.get(id);
    if (!s) { this.reportError("No button '" + id + "'"); return Promise.resolve(); }
    var el = s.el;
    var base = (dir === 'left' || dir === 'right') ? el.offsetWidth : el.offsetHeight;
    var d = isPercent ? (amount / 100) * base : amount;
    var dx = dir === 'left' ? -d : dir === 'right' ? d : 0;
    var dy = dir === 'up' ? -d : dir === 'down' ? d : 0;
    var sl = parseFloat(el.style.left) || 0, st = parseFloat(el.style.top) || 0;
    var ms = Math.max(0, secs) * 1000;
    if (ms <= 0) { el.style.left = (sl + dx) + 'px'; el.style.top = (st + dy) + 'px'; return Promise.resolve(); }
    return new Promise(function (resolve) {
      var t0 = performance.now();
      function step(now) {
        var t = Math.min((now - t0) / ms, 1);
        var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        el.style.left = (sl + dx * e) + 'px';
        el.style.top = (st + dy * e) + 'px';
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  };
  Player.prototype.triggerEffect = function (n) { return triggerEffect(cardEl, n); };
  Player.prototype.getText = function (n) {
    var el = this.texts.get(n); return el ? el.textContent : null;
  };
  Player.prototype.setText = function (n, v) {
    var el = this.texts.get(n); if (!el) return false; el.textContent = v; return true;
  };
  Player.prototype.currentCardName = function () {
    return (data.cards[this.index] || {}).name || '';
  };
  Player.prototype.currentCardNumber = function () { return this.index + 1; };
  Player.prototype.reportError = function (m) { this.message(m, true); };

  Player.prototype.message = function (text, isErr) {
    var bar = document.getElementById('msg');
    bar.textContent = text;
    bar.className = 'visible ' + (isErr ? 'error' : 'info');
    clearTimeout(this._t);
    this._t = setTimeout(function () { bar.className = ''; }, 5000);
  };

  /* --- dialogs --- */

  function dialog(title, bodyBuilder, buttons) {
    var bd = document.getElementById('dialog-backdrop');
    document.getElementById('dialog-title').textContent = title;
    var body = document.getElementById('dialog-body');
    var foot = document.getElementById('dialog-foot');
    body.innerHTML = '';
    foot.innerHTML = '';
    var extra = bodyBuilder(body);
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', function () { bd.className = ''; b.action(); });
      foot.appendChild(el);
    });
    bd.className = 'open';
    setTimeout(function () {
      var f = extra || foot.querySelector('.primary');
      if (f) { f.focus(); if (f.select) f.select(); }
    }, 50);
  }

  Player.prototype.ask = function (prompt) {
    return new Promise(function (resolve) {
      var field;
      dialog('Input', function (body) {
        var p = document.createElement('p'); p.textContent = prompt;
        field = document.createElement('input'); field.type = 'text';
        body.appendChild(p); body.appendChild(field);
        field.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('dialog-backdrop').className = '';
            resolve(field.value);
          }
        });
        return field;
      }, [{ label: 'OK', primary: true, action: function () { resolve(field.value); } }]);
    });
  };

  Player.prototype.say = function (prompt) {
    return new Promise(function (resolve) {
      dialog('Message', function (body) {
        var p = document.createElement('p'); p.textContent = prompt; body.appendChild(p);
      }, [{ label: 'OK', primary: true, action: resolve }]);
    });
  };

  Player.prototype.yesno = function (prompt) {
    return new Promise(function (resolve) {
      dialog('Question', function (body) {
        var p = document.createElement('p'); p.textContent = prompt; body.appendChild(p);
      }, [
        { label: 'No', action: function () { resolve(0); } },
        { label: 'Yes', primary: true, action: function () { resolve(1); } }
      ]);
    });
  };

  Player.prototype.speak = function (text) {
    var self = this;
    return new Promise(function (resolve) {
      if (!('speechSynthesis' in window) || !text) { resolve(); return; }
      var u = new SpeechSynthesisUtterance(text);
      u.rate = self.speechRate;
      var voice = findVoice(self.voiceName);
      if (voice) u.voice = voice;
      u.onend = resolve;
      u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });
  };

  Player.prototype.setVoice = function (name, rate) {
    if (name) this.voiceName = name;
    if (rate !== null && rate !== undefined) this.speechRate = wpmToRate(rate);
    return Promise.resolve();
  };

  new Player().show(0);
})();
`;

const EXPORT_CSS = `
:root {
  --bg: #eceef1; --surface: #fff; --border: #c3c8d0; --text: #1c1f24;
  --accent: #e8792b; --danger: #d1453b; --info: #2f6fd0;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #16181c; --surface: #272b32; --border: #454b55; --text: #e8eaed; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg);
  font-family: var(--font); color: var(--text);
  user-select: none; -webkit-user-select: none; }
#stage { height: 100vh; display: grid; place-items: center; padding: 16px; }
#card { position: relative; background: #fff; transform-origin: center center;
  box-shadow: 0 12px 32px rgba(0,0,0,.28); flex-shrink: 0; }
#paint { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
#objects { position: absolute; inset: 0; }
.obj { position: absolute; }
.obj-text { white-space: pre-wrap; word-break: break-word; line-height: 1.25;
  pointer-events: none; }
.obj-button { display: grid; place-items: center; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; cursor: pointer;
  overflow: hidden; font-size: 13px; color: var(--text);
  box-shadow: 0 1px 2px rgba(0,0,0,.08); transition: transform .06s; }
.obj-button:active { transform: translateY(1px); }
.obj-button.is-canvas { padding: 0; background: #fff; }
.obj-button img { width: 100%; height: 100%; display: block; pointer-events: none; }
.obj-button span { padding: 0 8px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; pointer-events: none; }
.obj-button.invisible { background: transparent; border: none; box-shadow: none;
  color: transparent; }
#msg { position: fixed; left: 50%; bottom: 16px;
  transform: translateX(-50%) translateY(8px); padding: 8px 16px; border-radius: 6px;
  font-size: 12px; opacity: 0; pointer-events: none; z-index: 200;
  transition: opacity .16s, transform .16s; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
#msg.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
#msg.error { background: var(--danger); color: #fff; }
#msg.info { background: var(--info); color: #fff; }
#dialog-backdrop { position: fixed; inset: 0; background: rgba(16,22,32,.32);
  display: none; align-items: flex-start; justify-content: center; z-index: 300; }
#dialog-backdrop.open { display: flex; }
#dialog { margin-top: 12vh; background: var(--surface); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.35); min-width: 340px; max-width: 90vw; }
#dialog-title { padding: 16px 16px 8px; font-size: 15px; font-weight: 600; }
#dialog-body { padding: 0 16px; line-height: 1.5; }
#dialog-body p { margin: 0 0 12px; }
#dialog-body input { width: 100%; height: 30px; padding: 0 8px; font: inherit;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  color: var(--text); user-select: text; -webkit-user-select: text; }
#dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px; }
.btn { height: 28px; padding: 0 14px; font: inherit; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
@keyframes fx-shake { 0%,100%{transform:translate(0,0) rotate(0)}
  10%{transform:translate(-6px,-4px) rotate(-1.5deg)} 20%{transform:translate(7px,3px) rotate(1deg)}
  30%{transform:translate(-5px,5px) rotate(-.8deg)} 40%{transform:translate(6px,-3px) rotate(1.2deg)}
  50%{transform:translate(-4px,4px) rotate(-1deg)} 60%{transform:translate(5px,-2px) rotate(.6deg)}
  70%{transform:translate(-3px,3px) rotate(-.5deg)} 80%{transform:translate(3px,-2px) rotate(.3deg)}
  90%{transform:translate(-2px,1px) rotate(-.2deg)} }
@keyframes fx-negative { 0%,49%{filter:invert(1) hue-rotate(180deg)} 50%,100%{filter:none} }
@keyframes fx-flash { 0%,100%{filter:none} 20%,60%{filter:brightness(3)} 40%,80%{filter:none} }
@keyframes fx-wobble { 0%,100%{transform:scaleX(1) scaleY(1)} 20%{transform:scaleX(1.04) scaleY(.96)}
  40%{transform:scaleX(.96) scaleY(1.04)} 60%{transform:scaleX(1.03) scaleY(.97)}
  80%{transform:scaleX(.98) scaleY(1.02)} }
.fx-shake { animation: fx-shake .5s ease-in-out; }
.fx-negative { animation: fx-negative .6s steps(1); }
.fx-flash { animation: fx-flash .5s ease-in-out; }
.fx-wobble { animation: fx-wobble .6s ease-in-out; }
`;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Keep embedded JSON from terminating the surrounding script element. */
function escapeJson(s) {
  return s.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}
