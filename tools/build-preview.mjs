/* Generates a static preview of the editor UI for sharing.

   The preview is built from the app's *real* stylesheets rather than a
   hand-written imitation: each selector is mechanically scoped under
   `.app-preview` so it cannot collide with the surrounding page, but every
   declaration is the one the app actually ships. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from '../src/editor/icons.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const styles = (n) => readFileSync(join(root, 'src', 'styles', n), 'utf8');

/** Scope a stylesheet under `.app-preview`, remapping :root onto the scope. */
function scopeCss(css, scope) {
  // Strip comments so brace counting inside them cannot confuse the split.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');

  return css.replace(
    /(^|\})\s*([^{}@]+?)\s*\{/g,
    (match, close, selectors) => {
      const scoped = selectors
        .split(',')
        .map((s) => {
          const sel = s.trim();
          if (!sel) return sel;
          // :root and the theme-stamped variants all become the scope itself.
          if (/^:root/.test(sel)) return scope;
          if (sel === 'html' || sel === 'body' || sel === 'html, body') return scope;
          if (sel === '*') return `${scope} *`;
          return `${scope} ${sel}`;
        })
        .filter(Boolean)
        .join(', ');
      return `${close} ${scoped} {`;
    }
  );
}

const appCss = [styles('tokens.css'), styles('app.css'), styles('controls.css')]
  .map((c) => scopeCss(c, '.app-preview'))
  .join('\n');

const cardArt =
  'data:image/png;base64,' +
  readFileSync(join(root, 'demo-art', 'card2.png')).toString('base64');

/* --- the editor DOM, matching what the app renders at runtime --- */

const TOOLS = [
  ['pointer', 'Pointer'], ['pencil', 'Pencil'], ['eraser', 'Eraser'],
  ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['fillRect', 'Filled Rectangle'],
  ['bucket', 'Paint Bucket'], ['lasso', 'Filled Shape Pencil'],
  ['polygon', 'Polygon'], ['text', 'Text'], ['button', 'Add Button'],
];

import { TOOL_META } from '../src/editor/icons.js';

const toolbar = TOOL_META.map(([id, label]) =>
  id === 'sep'
    ? '<div class="tool-sep"></div>'
    : `<button class="tool-btn${id === 'pencil' ? ' active' : ''}" title="${label}">${ICONS[id]}</button>`
).join('\n');

const CARDS = [
  ['start', 1, false],
  ['orchard', 2, true],
  ['win', 3, false],
];

const cardList = CARDS.map(
  ([name, n, active]) => `
    <div class="card-thumb${active ? ' active' : ''}">
      <div class="thumb-art"${active ? ` style="background-image:url('${cardArt}')"` : ''}></div>
      <div class="card-thumb-label"><b>${name}</b><span>${n}</span></div>
    </div>`
).join('');

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  .map((h) => `<div class="obj-handle handle-${h}"></div>`)
  .join('');

const preview = `
<div class="app-preview" aria-label="HyperMango editor interface">
  <div id="app">
    <div id="toolrail"><div id="tool-buttons">${toolbar}</div></div>
    <div id="optionsbar">
      <div class="field"><label>Stroke</label>
        <span class="color-well" style="--well-color:#1c3d1f"></span></div>
      <div class="field"><label>Fill</label>
        <span class="color-well" style="--well-color:#e8792b"></span></div>
      <div class="tool-sep"></div>
      <div class="field"><label>Size</label>
        <input type="range" min="1" max="40" value="6" tabindex="-1"><b style="font-size:11px">6</b></div>
      <div class="tool-sep"></div>
      <div class="field"><label>Font</label>
        <select tabindex="-1"><option>System</option></select></div>
      <div class="field"><label>Pt</label>
        <input type="number" value="30" style="width:56px" tabindex="-1"></div>
      <div style="flex:1"></div>
      <button class="btn primary">▶ Play</button>
    </div>

      <div id="canvas-pane">
        <div id="card-container" style="background-image:url('${cardArt}')">
          <div id="object-layer">
            <div class="obj obj-text" style="left:90px;top:80px;width:420px;height:44px;
                 font-family:ui-monospace,Menlo,monospace;font-size:30px;color:#1c3d1f">Score: 0<span class="obj-badge">text_score</span></div>
            <div class="obj obj-text" style="left:90px;top:132px;width:620px;height:36px;
                 font-size:20px;color:#3c5a3f">Pick the mangoes.</div>
            <div class="obj obj-button selected" style="left:90px;top:620px;width:210px;height:52px">
              <span class="obj-button-label">Pick a mango</span>
              <span class="obj-badge">pick</span>${handles}
            </div>
            <div class="obj obj-button" style="left:320px;top:620px;width:230px;height:52px">
              <span class="obj-button-label">Ask me something</span>
            </div>
            <div class="obj obj-button invisible" style="left:570px;top:620px;width:140px;height:52px">
              <span class="obj-button-label">← Back</span>
            </div>
          </div>
        </div>
      </div>

      <aside id="inspector">
        <div class="pane-title">Inspector</div>
        <div id="inspector-body">
          <div class="insp-section"><h3>Button</h3>
            <div class="insp-row"><label>Script name</label><input type="text" value="pick" tabindex="-1"></div>
            <div class="insp-row"><label>Label</label><input type="text" value="Pick a mango" tabindex="-1"></div>
          </div>
          <div class="insp-section"><h3>Layout</h3>
            <div class="insp-grid">
              <div class="insp-row"><label>X</label><input type="number" value="90" tabindex="-1"></div>
              <div class="insp-row"><label>Y</label><input type="number" value="620" tabindex="-1"></div>
              <div class="insp-row"><label>Width</label><input type="number" value="210" tabindex="-1"></div>
              <div class="insp-row"><label>Height</label><input type="number" value="52" tabindex="-1"></div>
            </div>
          </div>
          <div class="insp-section"><h3>Behaviour</h3>
            <div class="insp-row"><label>Sound</label><select tabindex="-1"><option>click</option></select></div>
            <div class="insp-row"><label>Effect</label><select tabindex="-1"><option>— none —</option></select></div>
          </div>
          <div class="insp-section"><h3>Appearance</h3>
            <div class="insp-row inline"><label>Invisible in Play mode</label><input type="checkbox" tabindex="-1"></div>
            <div class="insp-row inline"><label>Drawable canvas surface</label><input type="checkbox" tabindex="-1"></div>
          </div>
          <div class="insp-section"><h3>Script</h3>
            <button class="btn wide">Edit Script…</button>
          </div>
        </div>
      </aside>

      <div id="cardstrip">
        <div id="card-list">${cardList}</div>
        <button class="btn">+ Add Card</button>
      </div>

    <div id="statusbar">
      <span>Card <b>2 / 3</b></span>
      <span>Tool <b>Pencil</b></span>
      <span>Position <b>418, 260</b></span>
      <span class="spacer"></span><span><b>68%</b></span>
    </div>
  </div>
</div>`;

/* Extra rules the preview needs: the real app paints the card with a canvas
   element, which a static page cannot do, so the art becomes a background. */
const previewFixes = `
.app-preview { all: initial; display: block; font-family: var(--font-ui); }
.app-preview, .app-preview * { box-sizing: border-box; }
.app-preview #app { height: 660px; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); }
.app-preview #canvas-pane { overflow: hidden; }
.app-preview #card-container { width: 1063px; height: 797px;
  background-size: cover; transform: scale(0.5); transform-origin: center center; }
.app-preview .thumb-art { width: 100%; aspect-ratio: 1063/797; background: #fff;
  background-size: cover; }
.app-preview #toolbar { overflow: hidden; }
.app-preview input, .app-preview select, .app-preview button { pointer-events: none; }
`;

writeFileSync(
  join(here, 'preview-fragment.html'),
  `<style>\n${appCss}\n${previewFixes}\n</style>\n${preview}\n`
);
console.log('wrote tools/preview-fragment.html');
