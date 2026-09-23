/* ---------------------------------------------------------------------------
   Script editor.

   A transparent <textarea> stacked over a syntax-highlighted copy of the same
   text. The textarea keeps native editing, selection, undo, and IME behaviour;
   the layer underneath supplies the colour. Both use identical font metrics and
   padding, so the two stay aligned as long as neither wraps — hence
   `white-space: pre` and horizontal scrolling rather than soft wrap.

   The gutter marks the line the parser reports, so a mistake is visible while
   typing rather than at the moment the script runs.
   --------------------------------------------------------------------------- */

import { tryParse } from '../runtime/parser.js';

/** Block and control keywords. */
const KEYWORDS = new Set([
  'if', 'else', 'end', 'repeat', 'while', 'until', 'forever', 'times',
  'exit', 'next', 'stop', 'this', 'not', 'is', 'visible', 'card',
]);

/** Command verbs and their particles. */
const COMMANDS = new Set([
  'go', 'play', 'sound', 'show', 'hide', 'button', 'trigger', 'effect',
  'move', 'by', 'in', 'seconds', 'second', 'wait', 'done', 'ask', 'say',
  'yesno', 'speak', 'speaker', 'first', 'last', 'prev', 'previous', 'left', 'right', 'up', 'down',
]);

export class ScriptEditor {
  /**
   * @param {object} opts { value, tall, onChange }
   */
  constructor({ value = '', tall = false, onChange } = {}) {
    this.onChange = onChange;

    this.el = document.createElement('div');
    this.el.className = `script-editor${tall ? ' tall' : ''}`;
    this.el.innerHTML = `
      <div class="script-scroll">
        <div class="script-gutter"></div>
        <div class="script-stack">
          <pre class="script-highlight" aria-hidden="true"></pre>
          <textarea class="script-input" spellcheck="false" autocapitalize="off"
                    autocomplete="off" wrap="off"></textarea>
        </div>
      </div>
      <div class="script-status"></div>`;

    this.scroll = this.el.querySelector('.script-scroll');
    this.gutter = this.el.querySelector('.script-gutter');
    this.highlight = this.el.querySelector('.script-highlight');
    this.input = this.el.querySelector('.script-input');
    this.status = this.el.querySelector('.script-status');

    this.input.value = value;
    this.bind();
    this.refresh();
  }

  get value() {
    return this.input.value;
  }

  set value(v) {
    this.input.value = v ?? '';
    this.refresh();
  }

  focus() {
    this.input.focus();
  }

  bind() {
    this.input.addEventListener('input', () => {
      this.refresh();
      this.onChange?.(this.input.value);
    });

    // The textarea scrolls internally; mirror that onto the visible container
    // so the highlight layer and gutter track it.
    this.input.addEventListener('scroll', () => {
      this.scroll.scrollTop = this.input.scrollTop;
      this.scroll.scrollLeft = this.input.scrollLeft;
    });

    this.input.addEventListener('keydown', (e) => {
      // Editor shortcuts must not fire while typing a script.
      e.stopPropagation();

      if (e.key === 'Tab') {
        e.preventDefault();
        this.insert('  ');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.newlineWithIndent();
      }
    });
  }

  insert(text) {
    const { selectionStart: s, selectionEnd: e, value } = this.input;
    this.input.value = value.slice(0, s) + text + value.slice(e);
    this.input.selectionStart = this.input.selectionEnd = s + text.length;
    this.refresh();
    this.onChange?.(this.input.value);
  }

  /**
   * Enter keeps the current indent, adds a level after a block opener, and
   * removes one when the line being left is `end` or `else`.
   */
  newlineWithIndent() {
    const { selectionStart: s, value } = this.input;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const line = value.slice(lineStart, s);
    const indent = (line.match(/^[ \t]*/) || [''])[0];

    const firstWord = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const opensBlock = firstWord === 'if' || firstWord === 'repeat' || firstWord === 'else';
    const next = opensBlock ? indent + '  ' : indent;

    this.insert('\n' + next);
  }

  refresh() {
    const src = this.input.value;
    this.highlight.innerHTML = highlight(src);

    const { error } = tryParse(src);
    const lineCount = src.split('\n').length;

    this.gutter.innerHTML = Array.from({ length: lineCount }, (_, i) => {
      const n = i + 1;
      const bad = error && error.line === n;
      return bad
        ? `<span class="err-line">${n}</span>`
        : String(n);
    }).join('\n');

    if (error) {
      this.status.textContent = `Line ${error.line}: ${error.message}`;
      this.status.classList.add('error');
    } else {
      this.status.textContent = src.trim() ? 'No errors' : 'Empty script';
      this.status.classList.remove('error');
    }
    this.error = error;
  }
}

/**
 * Produce highlighted HTML. This is a display-only pass, independent of the
 * real lexer: it must never throw on partial input, since it runs on every
 * keystroke including mid-token states the lexer would reject.
 */
export function highlight(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === '-' && src[i + 1] === '-') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += span('tok-comment', src.slice(i, j));
      i = j;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      if (j < n && src[j] === '"') j++;
      out += span('tok-string', src.slice(i, j));
      i = j;
      continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.%]/.test(src[j])) j++;
      out += span('tok-number', src.slice(i, j));
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      const cls = KEYWORDS.has(lower) ? 'tok-keyword' : COMMANDS.has(lower) ? 'tok-command' : null;
      out += cls ? span(cls, word) : esc(word);
      i = j;
      continue;
    }

    out += esc(c);
    i++;
  }
  // A trailing newline needs a placeholder or the last gutter row misaligns.
  return out + '\n';
}

function span(cls, text) {
  return `<span class="${cls}">${esc(text)}</span>`;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
