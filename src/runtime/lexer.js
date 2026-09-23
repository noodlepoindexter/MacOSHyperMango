/* ---------------------------------------------------------------------------
   Lexer.

   The original web app tokenised with a hand-rolled loop inside its interpreter
   and threw the positions away, so a malformed script failed silently at run
   time. Every token here carries a line and column, which is what lets the
   parser report errors the editor can point at.

   The language is line-oriented: newlines are significant and are emitted as
   tokens rather than skipped.
   --------------------------------------------------------------------------- */

export const T = {
  WORD: 'word',       // bare identifier or command keyword
  NUMBER: 'number',
  STRING: 'string',
  OP: 'op',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  NEWLINE: 'newline',
  EOF: 'eof',
};

/** Multi-character operators must be tested before their single-char prefixes. */
const OPERATORS = ['>=', '<=', '==', '!=', '=', '>', '<', '+', '-', '*', '/', '&'];

/**
 * Commands whose argument is captured as raw text rather than tokenized.
 * Longer alternatives are listed first so 'speaker' matches in full rather
 * than the alternation stopping at 'speak'.
 */
const RAW_LINE_COMMAND = /^(speaker|speak)(?=[ \t]|$)/i;

export class LexError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'LexError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Turn source text into a flat token array terminated by EOF.
 * @param {string} src
 * @returns {{type: string, value: string, line: number, column: number}[]}
 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;
  // True at the first non-blank token of a line. `speak` and `speaker` are
  // only recognised in that position, matching every other command keyword.
  let atLineStart = true;

  const push = (type, value, l, c) => tokens.push({ type, value, line: l, column: c });

  while (i < n) {
    const ch = src[i];

    // Newline — significant. \r\n collapses to one token.
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      push(T.NEWLINE, '\n', line, col);
      i++;
      line++;
      col = 1;
      atLineStart = true;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      i++;
      col++;
      continue;
    }

    // `speak` takes free-form spoken text, and `speaker` a voice name that
    // may itself contain spaces (several macOS voices are two words, like
    // "Bad News" or "Pipe Organ"). Neither fits the normal WORD grammar, so
    // both are recognised here and their argument captured raw rather than
    // tokenized — see RAW_LINE_COMMAND below.
    const rawMatch = atLineStart ? RAW_LINE_COMMAND.exec(src.slice(i)) : null;
    if (rawMatch) {
      const word = rawMatch[1].toLowerCase();
      const cmdLine = line;
      const cmdCol = col;
      i += word.length;
      col += word.length;
      atLineStart = false;
      push(T.WORD, word, cmdLine, cmdCol);

      while (i < n && (src[i] === ' ' || src[i] === '\t')) {
        i++;
        col++;
      }

      const textCol = col;
      let end = i;
      while (end < n && src[end] !== '\n' && src[end] !== '\r') end++;
      let text = src.slice(i, end);

      // A fully quoted argument has its quotes stripped, matching how every
      // other command takes a quoted string; bare text is spoken exactly as
      // typed, punctuation and all.
      if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
        text = text.slice(1, -1);
      }

      push(T.STRING, text, cmdLine, textCol);
      col += end - i;
      i = end;
      continue;
    }

    atLineStart = false;

    // Comment: `--` to end of line. Consumed entirely; the newline still emits.
    if (ch === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') {
        i++;
        col++;
      }
      continue;
    }

    // String literal with backslash escapes.
    if (ch === '"') {
      const startLine = line;
      const startCol = col;
      i++;
      col++;
      let out = '';
      let closed = false;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          const esc = src[i + 1];
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
          col += 2;
          continue;
        }
        if (c === '"') {
          i++;
          col++;
          closed = true;
          break;
        }
        if (c === '\n' || c === '\r') break; // unterminated — report at the quote
        out += c;
        i++;
        col++;
      }
      if (!closed) {
        throw new LexError('Unterminated string — missing closing quote', startLine, startCol);
      }
      push(T.STRING, out, startLine, startCol);
      continue;
    }

    // Number. A leading '-' is handled by the parser as unary minus so that
    // `score - 1` does not lex as `score` followed by `-1`.
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      const startCol = col;
      let out = '';
      while (i < n && (isDigit(src[i]) || src[i] === '.')) {
        out += src[i];
        i++;
        col++;
      }
      // A trailing '%' makes the number a percentage, used by `move … by 50%`.
      if (src[i] === '%') {
        out += '%';
        i++;
        col++;
      }
      push(T.NUMBER, out, line, startCol);
      continue;
    }

    if (ch === '(') {
      push(T.LPAREN, '(', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === ')') {
      push(T.RPAREN, ')', line, col);
      i++;
      col++;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      push(T.OP, op, line, col);
      i += op.length;
      col += op.length;
      continue;
    }

    // Bare word: identifiers, command keywords, and card names alike. Card and
    // sound names in real stacks contain digits and underscores.
    if (isWordStart(ch)) {
      const startCol = col;
      let out = '';
      while (i < n && isWordPart(src[i])) {
        out += src[i];
        i++;
        col++;
      }
      push(T.WORD, out, line, startCol);
      continue;
    }

    throw new LexError(`Unexpected character '${ch}'`, line, col);
  }

  push(T.EOF, '', line, col);
  return tokens;
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

function isWordStart(c) {
  return /[A-Za-z_]/.test(c);
}

function isWordPart(c) {
  return /[A-Za-z0-9_.]/.test(c);
}
