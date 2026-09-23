/* ---------------------------------------------------------------------------
   Inspector.

   The web version edited object properties through modal dialogs, so seeing a
   button's script meant losing sight of the card. Here properties live in a
   side panel that follows the selection and edits the model directly.
   --------------------------------------------------------------------------- */

import { row, input } from './sheet.js';
import { SYNTH_SOUNDS, BUNDLED_SOUNDS } from '../runtime/audio.js';
import { EFFECTS } from '../runtime/effects.js';

export class Inspector {
  /**
   * @param {HTMLElement} el   #inspector-body
   * @param {object} app       editor facade
   */
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  /** Re-render for the current selection. */
  render(selection) {
    this.el.innerHTML = '';
    const card = this.app.currentCard();
    if (!card) return;

    if (!selection) {
      this.renderCard(card);
      return;
    }
    const list = selection.kind === 'text' ? card.textObjects : card.buttons;
    const obj = list.find((o) => o.id === selection.id);
    if (!obj) {
      this.renderCard(card);
      return;
    }
    if (selection.kind === 'text') this.renderText(obj);
    else this.renderButton(obj);
  }

  section(title) {
    const s = document.createElement('div');
    s.className = 'insp-section';
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      s.appendChild(h);
    }
    this.el.appendChild(s);
    return s;
  }

  /** Commit a model change and refresh whatever depends on it. */
  change(redrawObjects = true) {
    this.app.commit({ redrawObjects });
  }

  // --- card ---------------------------------------------------------------

  renderCard(card) {
    const s = this.section('Card');

    const name = input('text', card.name, { maxlength: '40' });
    name.addEventListener('change', () => {
      const next = this.app.renameCard(card, name.value.trim());
      name.value = next;
    });
    s.appendChild(row('Name', name));

    const stats = document.createElement('p');
    stats.style.cssText =
      'color:var(--text-muted);font-size:var(--text-xs);margin:4px 0 0;line-height:1.6';
    stats.textContent =
      `${card.buttons.length} button${card.buttons.length === 1 ? '' : 's'} · ` +
      `${card.textObjects.length} text object${card.textObjects.length === 1 ? '' : 's'}`;
    s.appendChild(stats);

    const scriptSection = this.section('Card Script');
    const hint = document.createElement('p');
    hint.style.cssText =
      'color:var(--text-muted);font-size:var(--text-xs);margin:0 0 8px;line-height:1.5';
    hint.textContent = 'Runs when the card is entered in Play mode.';
    scriptSection.appendChild(hint);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn wide';
    editBtn.textContent = card.script?.trim() ? 'Edit Script…' : 'Add Script…';
    editBtn.addEventListener('click', () => this.app.openScriptSheet('card', card.id));
    scriptSection.appendChild(editBtn);

    const actions = this.section('');
    const clear = document.createElement('button');
    clear.className = 'btn wide';
    clear.textContent = 'Clear Drawing';
    clear.addEventListener('click', () => this.app.clearCardDrawing());
    actions.appendChild(clear);

    const del = document.createElement('button');
    del.className = 'btn wide danger';
    del.style.marginTop = 'var(--space-2)';
    del.textContent = 'Delete Card';
    del.addEventListener('click', () => this.app.deleteCurrentCard());
    actions.appendChild(del);
  }

  // --- text ---------------------------------------------------------------

  renderText(obj) {
    const s = this.section('Text');

    const idRow = document.createElement('div');
    idRow.style.cssText =
      'font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text-muted);margin-bottom:8px';
    idRow.textContent = `Script name: ${obj.id}`;
    s.appendChild(idRow);

    const content = document.createElement('textarea');
    content.rows = 3;
    content.value = obj.content;
    content.addEventListener('input', () => {
      obj.content = content.value;
      this.change();
    });
    s.appendChild(row('Content', content));

    const geom = this.section('Layout');
    geom.appendChild(this.numberGrid(obj, [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']]));

    const style = this.section('Style');
    const family = document.createElement('select');
    for (const [val, label] of [
      ['system-ui, sans-serif', 'System'],
      ['Georgia, serif', 'Serif'],
      ['Helvetica, Arial, sans-serif', 'Sans'],
      ['ui-monospace, Menlo, monospace', 'Mono'],
      ['cursive', 'Cursive'],
      ['fantasy', 'Display'],
    ]) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      family.appendChild(o);
    }
    family.value = obj.fontFamily;
    family.addEventListener('change', () => {
      obj.fontFamily = family.value;
      this.change();
    });
    style.appendChild(row('Font', family));

    const grid = document.createElement('div');
    grid.className = 'insp-grid';
    const size = input('number', obj.fontSize, { min: '8', max: '144' });
    size.addEventListener('change', () => {
      obj.fontSize = clampNum(size.value, 8, 144, obj.fontSize);
      size.value = obj.fontSize;
      this.change();
    });
    const colour = input('color', obj.color);
    colour.addEventListener('input', () => {
      obj.color = colour.value;
      this.change();
    });
    grid.append(row('Size', size), row('Colour', colour));
    style.appendChild(grid);

    this.deleteButton('Delete Text', () => this.app.deleteSelectedObject());
  }

  // --- button -------------------------------------------------------------

  renderButton(obj) {
    const s = this.section('Button');

    const nameId = input('text', obj.nameId, { maxlength: '40' });
    nameId.addEventListener('change', () => {
      obj.nameId = this.app.uniqueButtonName(obj, nameId.value.trim());
      nameId.value = obj.nameId;
      this.change();
    });
    s.appendChild(row('Script name', nameId));

    if (!obj.isCanvas) {
      const label = input('text', obj.label, { maxlength: '40' });
      label.addEventListener('input', () => {
        obj.label = label.value;
        this.change();
      });
      s.appendChild(row('Label', label));
    }

    const geom = this.section('Layout');
    geom.appendChild(this.numberGrid(obj, [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']]));

    const behaviour = this.section('Behaviour');

    const goto = input('number', obj.goto, { min: '0' });
    goto.addEventListener('change', () => {
      obj.goto = Math.max(0, parseInt(goto.value, 10) || 0);
      goto.value = obj.goto;
      this.change(false);
    });
    behaviour.appendChild(row('Go to card (0 = none)', goto));

    const sound = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— none —';
    sound.appendChild(none);
    const groups = [
      ['Built in', SYNTH_SOUNDS],
      ['Bundled', BUNDLED_SOUNDS],
      ['Imported', Object.keys(this.app.stack().customSounds)],
    ];
    for (const [label, names] of groups) {
      if (!names.length) continue;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const nm of names) {
        const o = document.createElement('option');
        o.value = nm;
        o.textContent = nm;
        g.appendChild(o);
      }
      sound.appendChild(g);
    }
    sound.value = obj.sound || '';
    sound.addEventListener('change', () => {
      obj.sound = sound.value;
      this.change(false);
    });
    behaviour.appendChild(row('Sound', sound));

    const effect = document.createElement('select');
    const enone = document.createElement('option');
    enone.value = '';
    enone.textContent = '— none —';
    effect.appendChild(enone);
    for (const nm of EFFECTS) {
      const o = document.createElement('option');
      o.value = nm;
      o.textContent = nm;
      effect.appendChild(o);
    }
    effect.value = obj.effect || '';
    effect.addEventListener('change', () => {
      obj.effect = effect.value;
      this.change(false);
    });
    behaviour.appendChild(row('Effect', effect));

    const appearance = this.section('Appearance');
    appearance.appendChild(
      this.checkbox('Invisible in Play mode', obj.invisible, (v) => {
        obj.invisible = v;
        this.change();
      })
    );
    appearance.appendChild(
      this.checkbox('Drawable canvas surface', obj.isCanvas, (v) => {
        obj.isCanvas = v;
        if (!v) obj.canvasData = null;
        this.change();
        this.render({ kind: 'button', id: obj.id }); // label field appears/disappears
      })
    );

    const scriptSection = this.section('Script');
    const hint = document.createElement('p');
    hint.style.cssText =
      'color:var(--text-muted);font-size:var(--text-xs);margin:0 0 8px;line-height:1.5';
    hint.textContent = obj.script?.trim()
      ? 'A script overrides Go to card and Sound.'
      : 'Runs when the button is clicked.';
    scriptSection.appendChild(hint);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn wide';
    editBtn.textContent = obj.script?.trim() ? 'Edit Script…' : 'Add Script…';
    editBtn.addEventListener('click', () => this.app.openScriptSheet('button', obj.id));
    scriptSection.appendChild(editBtn);

    this.deleteButton('Delete Button', () => this.app.deleteSelectedObject());
  }

  // --- shared -------------------------------------------------------------

  numberGrid(obj, fields) {
    const grid = document.createElement('div');
    grid.className = 'insp-grid';
    for (const [key, label] of fields) {
      const el = input('number', Math.round(obj[key]));
      el.addEventListener('change', () => {
        const v = parseInt(el.value, 10);
        if (Number.isFinite(v)) {
          obj[key] = key === 'w' || key === 'h' ? Math.max(16, v) : v;
        }
        el.value = Math.round(obj[key]);
        this.change();
      });
      grid.appendChild(row(label, el));
    }
    return grid;
  }

  checkbox(label, checked, onToggle) {
    const box = input('checkbox', '');
    box.checked = checked;
    box.addEventListener('change', () => onToggle(box.checked));
    const r = document.createElement('div');
    r.className = 'insp-row inline';
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l, box);
    return r;
  }

  deleteButton(label, onClick) {
    const s = this.section('');
    const b = document.createElement('button');
    b.className = 'btn wide danger';
    b.textContent = label;
    b.addEventListener('click', onClick);
    s.appendChild(b);
  }
}

function clampNum(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
