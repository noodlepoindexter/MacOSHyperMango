/* ---------------------------------------------------------------------------
   Document lifecycle: open, save, save-as, export, and dirty tracking.

   All disk work goes through Rust commands (see src-tauri/src/format.rs) so
   atomicity and format conversion live in one place. This module only decides
   *when* to call them and keeps the window title honest.
   --------------------------------------------------------------------------- */

import { invoke } from '@tauri-apps/api/core';
import { open, save, ask, message } from '@tauri-apps/plugin-dialog';
import { fromDocument, toDocument, createStack } from './stack.js';

const FILTERS = {
  native: { name: 'HyperMango Stack', extensions: ['hmango'] },
  web: { name: 'HyperMango Web Stack', extensions: ['hweb'] },
  html: { name: 'HTML Page', extensions: ['html'] },
};

export class DocumentController {
  /**
   * @param {object} app  host with { getStack(), setStack(stack), syncBeforeSave() }
   */
  constructor(app) {
    this.app = app;
    this.path = null;      // null until first save
    this.dirty = false;
  }

  get displayName() {
    return this.app.getStack().projectName || 'Untitled Stack';
  }

  markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.syncTitle();
    }
  }

  markClean() {
    this.dirty = false;
    this.syncTitle();
  }

  syncTitle() {
    invoke('set_document_edited', {
      edited: this.dirty,
      title: `${this.displayName} — HyperMango`,
    }).catch(() => {
      /* window may be closing */
    });
  }

  /** Prompt to save when the current document has unsaved changes.
      @returns {Promise<boolean>} false if the user cancelled */
  async confirmDiscard() {
    if (!this.dirty) return true;
    const keep = await ask(
      `"${this.displayName}" has unsaved changes. Save before continuing?`,
      { title: 'Unsaved Changes', kind: 'warning', okLabel: 'Save', cancelLabel: 'Discard' }
    );
    if (keep) return this.save();
    return true;
  }

  async newStack() {
    if (!(await this.confirmDiscard())) return;
    this.app.setStack(createStack());
    this.path = null;
    this.markClean();
  }

  async openStack() {
    if (!(await this.confirmDiscard())) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: 'HyperMango Stacks', extensions: ['hmango', 'hweb'] },
        FILTERS.native,
        FILTERS.web,
      ],
    });
    if (!selected) return;
    await this.loadPath(selected);
  }

  async loadPath(path) {
    try {
      const doc = await invoke('load_document', { path });
      this.app.setStack(fromDocument(doc));
      // Opening a .hweb leaves the document untitled: saving it should produce
      // a native package rather than silently overwriting the imported file.
      this.path = path.endsWith('.hweb') ? null : path;
      this.markClean();
    } catch (e) {
      await message(String(e), { title: 'Could not open stack', kind: 'error' });
    }
  }

  /** @returns {Promise<boolean>} true if the save completed */
  async save() {
    if (!this.path) return this.saveAs();
    return this.writeTo(this.path);
  }

  async saveAs() {
    const path = await save({
      defaultPath: `${safeName(this.displayName)}.hmango`,
      filters: [FILTERS.native],
    });
    if (!path) return false;
    const ok = await this.writeTo(path);
    if (ok) this.path = path;
    return ok;
  }

  async writeTo(path) {
    try {
      await this.app.syncBeforeSave();
      await invoke('save_document', { path, doc: toDocument(this.app.getStack()) });
      this.markClean();
      return true;
    } catch (e) {
      await message(String(e), { title: 'Could not save stack', kind: 'error' });
      return false;
    }
  }

  async importHweb() {
    if (!(await this.confirmDiscard())) return;
    const selected = await open({ multiple: false, filters: [FILTERS.web] });
    if (!selected) return;
    await this.loadPath(selected);
  }

  async exportHweb() {
    const path = await save({
      defaultPath: `${safeName(this.displayName)}.hweb`,
      filters: [FILTERS.web],
    });
    if (!path) return;
    try {
      await this.app.syncBeforeSave();
      await invoke('export_hweb', { path, doc: toDocument(this.app.getStack()) });
    } catch (e) {
      await message(String(e), { title: 'Could not export', kind: 'error' });
    }
  }

  async exportHtml(buildHtml) {
    const path = await save({
      defaultPath: `${safeName(this.displayName)}.html`,
      filters: [FILTERS.html],
    });
    if (!path) return;
    try {
      await this.app.syncBeforeSave();
      await invoke('export_html', { path, html: buildHtml(this.app.getStack()) });
    } catch (e) {
      await message(String(e), { title: 'Could not export', kind: 'error' });
    }
  }
}

function safeName(name) {
  return (name || 'Untitled').replace(/[^\w\-. ]+/g, '_').trim() || 'Untitled';
}
