/* ---------------------------------------------------------------------------
   Document lifecycle: open, save, save-as, export, and dirty tracking.

   All disk work goes through Rust commands (see src-tauri/src/format.rs) so
   atomicity and format conversion live in one place. This module only decides
   *when* to call them and keeps the window title honest.
   --------------------------------------------------------------------------- */

import { invoke } from '@tauri-apps/api/core';
import { open, save, message } from '@tauri-apps/plugin-dialog';
import { fromDocument, toDocument, createStack } from './stack.js';

const BACKUP_INTERVAL_MS = 60_000;
const TOAST_MS = 1500;

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
    this.confirming = false;
    this.changedSinceBackup = false;
    this.driveFileId = null; // Drive copy of this document, once uploaded
    setInterval(() => this.backup(), BACKUP_INTERVAL_MS);
  }

  /** The saved file's name once there is one; the project name until then. */
  get displayName() {
    if (this.path) return baseName(this.path);
    return this.app.getStack().projectName || 'Untitled Stack';
  }

  markDirty() {
    this.changedSinceBackup = true;
    if (!this.dirty) {
      this.dirty = true;
      this.syncTitle();
    }
  }

  markClean() {
    this.dirty = false;
    return this.syncTitle();
  }

  syncTitle() {
    return invoke('set_document_edited', {
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
    if (this.confirming) return false; // a prompt is already showing
    this.confirming = true;
    let choice;
    try {
      choice = await message(
        `Do you want to save the changes you made to "${this.displayName}"?\n\n` +
          'Your changes will be lost if you don\u2019t save them.',
        {
          title: 'Unsaved Changes',
          kind: 'warning',
          buttons: { yes: 'Save', no: 'Don\u2019t Save', cancel: 'Cancel' },
        }
      );
    } finally {
      this.confirming = false;
    }
    if (choice === 'Save' || choice === 'Yes') return this.save();
    if (choice === 'Don\u2019t Save' || choice === 'No') {
      // Clear the flag (here and in Rust) so a pending quit or close isn't
      // intercepted a second time.
      await this.markClean();
      return true;
    }
    return false;
  }

  async quit() {
    if (await this.confirmDiscard()) await invoke('quit_app');
  }

  async newStack() {
    if (!(await this.confirmDiscard())) return;
    this.app.setStack(createStack());
    this.path = null;
    this.changedSinceBackup = false;
    this.driveFileId = null;
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

  async openRecent(path) {
    if (!(await this.confirmDiscard())) return;
    await this.loadPath(path, { fromRecent: true });
  }

  async loadPath(path, { fromRecent = false } = {}) {
    try {
      const doc = await invoke('load_document', { path });
      this.app.setStack(fromDocument(doc));
      this.changedSinceBackup = false;
      this.driveFileId = null;
      // Opening a .hweb leaves the document untitled: saving it should produce
      // a native package rather than silently overwriting the imported file.
      this.path = path.endsWith('.hweb') ? null : path;
      this.markClean();
      noteRecent(path);
    } catch (e) {
      if (fromRecent) invoke('forget_recent', { path }).catch(() => {});
      await message(String(e), { title: 'Could not open stack', kind: 'error' });
    }
  }

  /** @returns {Promise<boolean>} true if the save completed */
  async save() {
    if (!this.path) return this.saveAs();
    return this.writeTo(this.path);
  }

  async saveAs() {
    let path = await save({
      defaultPath: `${safeName(this.displayName)}.hmango`,
      filters: [FILTERS.native],
    });
    if (!path) return false;
    if (!/\.hmango$/i.test(path)) path += '.hmango';
    const previous = this.path;
    this.path = path; // set before writing so the title reflects the new name
    // A stack that was never named takes the file's name, so Play and HTML
    // exports don't keep calling it "Untitled Stack".
    const stack = this.app.getStack();
    if (!stack.projectName || stack.projectName === 'Untitled Stack') {
      stack.projectName = baseName(path);
    }
    const ok = await this.writeTo(path);
    if (!ok) {
      this.path = previous;
      this.syncTitle();
    }
    return ok;
  }

  async writeTo(path) {
    try {
      await this.app.syncBeforeSave();
      await invoke('save_document', { path, doc: toDocument(this.app.getStack()) });
      await this.markClean();
      noteRecent(path);
      showToast(`You saved: ${fileName(path)}`);
      return true;
    } catch (e) {
      await message(String(e), { title: 'Could not save stack', kind: 'error' });
      return false;
    }
  }

  /** Write a copy to the backups folder if anything changed since the last
      one. Runs on a timer; failures are logged, never shown, because the
      user didn't ask for this save. */
  async backup() {
    if (!this.changedSinceBackup || this.backingUp) return;
    this.backingUp = true;
    this.changedSinceBackup = false;
    try {
      await this.app.syncBeforeSave();
      await invoke('write_backup', {
        path: this.path,
        doc: toDocument(this.app.getStack()),
      });
    } catch (e) {
      this.changedSinceBackup = true; // try again next tick
      console.warn('Backup failed:', e);
    } finally {
      this.backingUp = false;
    }
  }

  /** Upload a copy to the user's Google Drive. The first time, this opens the
      browser to sign in; later saves of the same document update its Drive
      file rather than adding another. Doesn't change the local dirty state:
      Drive is a copy, not where the document lives. */
  async saveToDrive() {
    if (this.uploading) return;
    this.uploading = true;
    const btn = document.getElementById('save-drive-btn');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await this.app.syncBeforeSave();
      this.driveFileId = await invoke('drive_save', {
        localPath: this.path,
        fileId: this.driveFileId,
        name: this.displayName,
        doc: toDocument(this.app.getStack()),
      });
      showToast(`Saved to Google Drive: ${this.displayName}.hmango`);
    } catch (e) {
      await message(String(e), { title: 'Could not save to Google Drive', kind: 'error' });
    } finally {
      this.uploading = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  async driveSignOut() {
    try {
      await invoke('drive_sign_out');
      showToast('Signed out of Google Drive');
    } catch (e) {
      await message(String(e), { title: 'Could not sign out', kind: 'error' });
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

/** The recent list is a convenience; failing to update it never blocks a save. */
function noteRecent(path) {
  invoke('note_recent', { path }).catch(() => {});
}

function fileName(path) {
  return path.split(/[\\/]/).pop() || path;
}

function baseName(path) {
  return fileName(path).replace(/\.(hmango|hweb)$/i, '') || 'Untitled Stack';
}

let toastTimer;
function showToast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  // Force a reflow so re-showing an already-visible toast restarts cleanly.
  void el.offsetWidth;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), TOAST_MS);
}

function safeName(name) {
  return (name || 'Untitled').replace(/[^\w\-. ]+/g, '_').trim() || 'Untitled';
}
