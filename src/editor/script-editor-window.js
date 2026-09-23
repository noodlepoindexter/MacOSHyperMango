/* ---------------------------------------------------------------------------
   Entry point for the script-editor window.

   This used to be an in-app modal sheet; it is now a real, separate Tauri
   window (native titlebar, traffic lights, draggable, closable independently
   of the editor). Because it is a separate webview it shares no JS state with
   the main window at all — the script text it starts with arrives via
   localStorage (written by the main window right before this window is
   created, keyed by this window's own label so several script editors can be
   open at once without clobbering each other), and edits are written back the
   same way play mode reports nothing back: over a Tauri event, since that is
   the only channel between webviews.
   --------------------------------------------------------------------------- */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';
import { ScriptEditor } from './script-editor.js';

const label = new URLSearchParams(location.search).get('w') || getCurrentWindow().label;
const storageKey = `hypermango:script:${label}`;

function loadPayload() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  // One-shot: a reload of this same window (e.g. after a crash recovery)
  // should not resurrect a payload meant for a single open.
  localStorage.removeItem(storageKey);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function openReferenceWindow() {
  const existing = await WebviewWindow.getByLabel('reference');
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow('reference', {
    url: 'reference.html',
    title: 'Script Reference',
    width: 460,
    height: 720,
    minWidth: 360,
    minHeight: 420,
    resizable: true,
  });
}

function boot() {
  const payload = loadPayload();
  if (!payload) {
    document.getElementById('script-page').innerHTML =
      '<p style="padding:24px;font-family:system-ui;color:var(--text-muted)">' +
      'This script editor window has nothing to edit — close it and reopen ' +
      'from the app.</p>';
    return;
  }
  const { kind, id } = payload;

  const editor = new ScriptEditor({ value: payload.script || '', tall: true });
  document.getElementById('script-host').appendChild(editor.el);
  requestAnimationFrame(() => editor.focus());

  const statusEl = document.getElementById('script-save-status');
  let statusTimer = null;

  async function save() {
    await emitTo('main', 'script-editor:save', { kind, id, script: editor.value });
    statusEl.textContent = 'Saved';
    statusEl.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('visible'), 1500);
  }

  document.getElementById('script-save-btn').addEventListener('click', save);
  document.getElementById('script-close-btn').addEventListener('click', () => {
    getCurrentWindow().close();
  });
  document.getElementById('script-reference-btn').addEventListener('click', openReferenceWindow);

  // The native Save menu item (⌘S) dispatches to whichever window is
  // focused; wire it here the same way it would work in any other document
  // window, rather than only being reachable from the footer button.
  getCurrentWindow().listen('menu', (event) => {
    if (event.payload === 'file.save') save();
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(statusTimer);
  });
}

boot();
