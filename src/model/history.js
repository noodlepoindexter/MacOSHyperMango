/* ---------------------------------------------------------------------------
   Undo / redo.

   Snapshot-based, like the web version: each entry captures a card's paint
   layer plus its objects. The web version kept snapshots as data URL strings
   and never capped the stack, so a long drawing session grew without bound.
   Here snapshots hold Blobs and the depth is capped.
   --------------------------------------------------------------------------- */

const MAX_DEPTH = 40;

export class History {
  constructor(depth = MAX_DEPTH) {
    this.depth = depth;
    /** @type {Map<string, {undo: object[], redo: object[]}>} keyed by card id */
    this.perCard = new Map();
    this.onChange = null;
  }

  stackFor(cardId) {
    if (!this.perCard.has(cardId)) this.perCard.set(cardId, { undo: [], redo: [] });
    return this.perCard.get(cardId);
  }

  /**
   * Record the current state of a card before a mutation.
   * @param {string} cardId
   * @param {object} snapshot  {paint: Blob|null, texts: object[], buttons: object[]}
   */
  push(cardId, snapshot) {
    const s = this.stackFor(cardId);
    s.undo.push(snapshot);
    if (s.undo.length > this.depth) s.undo.shift();
    // Any new edit invalidates the redo branch.
    s.redo.length = 0;
    this.notify();
  }

  canUndo(cardId) {
    return this.stackFor(cardId).undo.length > 0;
  }

  canRedo(cardId) {
    return this.stackFor(cardId).redo.length > 0;
  }

  /**
   * @param {string} cardId
   * @param {object} current  snapshot of the state being replaced
   * @returns {object|null}   the state to restore
   */
  undo(cardId, current) {
    const s = this.stackFor(cardId);
    if (s.undo.length === 0) return null;
    s.redo.push(current);
    const state = s.undo.pop();
    this.notify();
    return state;
  }

  redo(cardId, current) {
    const s = this.stackFor(cardId);
    if (s.redo.length === 0) return null;
    s.undo.push(current);
    const state = s.redo.pop();
    this.notify();
    return state;
  }

  /** Drop history for a card that no longer exists. */
  forget(cardId) {
    this.perCard.delete(cardId);
    this.notify();
  }

  clear() {
    this.perCard.clear();
    this.notify();
  }

  notify() {
    if (this.onChange) this.onChange();
  }
}
