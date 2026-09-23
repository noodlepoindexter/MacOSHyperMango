/* A single reusable modal sheet. Every dialog in the app renders into it, so
   there is one place that handles focus, Escape, and backdrop dismissal. */

const backdrop = () => document.getElementById('sheet');

let onClose = null;

/**
 * Show a sheet.
 * @param {object} opts
 *   title    heading text
 *   body     HTMLElement or HTML string
 *   buttons  [{label, kind?: 'primary'|'danger', action?: fn, close?: bool}]
 *   onClose  called after dismissal
 *   width    optional CSS width for the sheet
 */
export function openSheet({ title, body, buttons = [], onClose: cb, width }) {
  const bd = backdrop();
  const panel = bd.querySelector('.sheet');
  const titleEl = document.getElementById('sheet-title');
  const bodyEl = document.getElementById('sheet-body');
  const footEl = document.getElementById('sheet-foot');

  titleEl.textContent = title;
  bodyEl.innerHTML = '';
  if (body instanceof HTMLElement) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body ?? '';

  footEl.innerHTML = '';
  for (const b of buttons) {
    if (b.spacer) {
      const s = document.createElement('div');
      s.className = 'spacer';
      footEl.appendChild(s);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = `btn${b.kind ? ' ' + b.kind : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', async () => {
      // A handler returning false keeps the sheet open (e.g. validation failed).
      const keep = b.action ? await b.action() : undefined;
      if (b.close !== false && keep !== false) closeSheet();
    });
    footEl.appendChild(btn);
  }

  panel.style.width = width || '';
  onClose = cb || null;
  bd.classList.add('open');

  // Focus the first field, or the primary button when there is none.
  requestAnimationFrame(() => {
    const target =
      bodyEl.querySelector('input, textarea, select') || footEl.querySelector('.primary');
    target?.focus();
    if (target?.select) target.select();
  });
}

export function closeSheet() {
  const bd = backdrop();
  if (!bd.classList.contains('open')) return;
  bd.classList.remove('open');
  const cb = onClose;
  onClose = null;
  cb?.();
}

export function isSheetOpen() {
  return backdrop().classList.contains('open');
}

/** Wire global dismissal once at startup. */
export function initSheets() {
  const bd = backdrop();
  bd.addEventListener('pointerdown', (e) => {
    if (e.target === bd) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSheetOpen()) {
      e.stopPropagation();
      closeSheet();
    }
  });
}

/** Build a labelled form row. */
export function row(labelText, control, inline = false) {
  const r = document.createElement('div');
  r.className = `insp-row${inline ? ' inline' : ''}`;
  if (labelText) {
    const l = document.createElement('label');
    l.textContent = labelText;
    r.appendChild(l);
  }
  r.appendChild(control);
  return r;
}

export function input(type, value, attrs = {}) {
  const el = document.createElement('input');
  el.type = type;
  el.value = value ?? '';
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
