/* ---------------------------------------------------------------------------
   Parser — tokens to AST.

   The web version had no parser: `runScript()` walked raw lines and executed as
   it scanned, re-finding matching `end` keywords by counting depth on every
   branch. That made loops impractical and errors invisible until the moment a
   line ran.

   Producing a tree up front is what makes three things possible at once:
   `repeat` blocks, `else if` chains, and error reporting the editor can anchor
   to a line and column before the script is ever run.

   Grammar (statements are line-delimited):

     program    := statement*
     statement  := ifStmt | repeatStmt | assignment | command
                 | 'stop' | 'exit' 'repeat' | 'next' 'repeat'
     ifStmt     := 'if' cond NEWLINE block
                   ('else' 'if' cond NEWLINE block)*
                   ('else' NEWLINE block)? 'end'
     repeatStmt := 'repeat' (expr | 'while' cond | 'until' cond | 'forever')?
                   NEWLINE block 'end'
     assignment := WORD '=' expr

   Expression precedence, loosest first:

     compare  := concat (('>'|'<'|'>='|'<='|'=='|'!=') concat)?
     concat   := additive ('&' additive)*
     additive := term (('+'|'-') term)*
     term     := unary (('*'|'/') unary)*
     unary    := '-' unary | primary
     primary  := NUMBER | STRING | WORD | '(' compare ')'
   --------------------------------------------------------------------------- */

import { tokenize, T, LexError } from './lexer.js';

export class ParseError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
  }
}

/** Directions accepted by `move`. */
const DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

/** Words that terminate a block. Checked case-insensitively. */
const BLOCK_ENDERS = new Set(['end', 'else']);

/**
 * Parse script source into an AST.
 * @param {string} src
 * @returns {{type:'Program', body: object[]}}
 * @throws {ParseError|LexError}
 */
export function parse(src) {
  const tokens = tokenize(src);
  const p = new Parser(tokens);
  return p.parseProgram();
}

/**
 * Parse and return errors instead of throwing — used by the editor to paint the
 * gutter on every keystroke without wrapping each call in try/catch.
 * @returns {{ast: object|null, error: {message,line,column}|null}}
 */
export function tryParse(src) {
  try {
    return { ast: parse(src), error: null };
  } catch (e) {
    if (e instanceof ParseError || e instanceof LexError) {
      return { ast: null, error: { message: e.message, line: e.line, column: e.column } };
    }
    throw e;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // --- token helpers -------------------------------------------------------

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  atEnd() {
    return this.peek().type === T.EOF;
  }

  /** True if the current token is the given bare word (case-insensitive). */
  isWord(word, offset = 0) {
    const t = this.peek(offset);
    return t.type === T.WORD && t.value.toLowerCase() === word;
  }

  /** Consume the current token if it is the given word. */
  acceptWord(word) {
    if (this.isWord(word)) {
      this.next();
      return true;
    }
    return false;
  }

  expectWord(word, what) {
    if (!this.acceptWord(word)) {
      const t = this.peek();
      throw new ParseError(
        `Expected '${word}'${what ? ` ${what}` : ''}, found ${describe(t)}`,
        t.line,
        t.column
      );
    }
  }

  /** Skip blank lines. */
  skipNewlines() {
    while (this.peek().type === T.NEWLINE) this.next();
  }

  /** Consume the end of a statement, erroring on trailing junk. */
  endStatement() {
    const t = this.peek();
    if (t.type === T.NEWLINE) {
      this.next();
      return;
    }
    if (t.type === T.EOF) return;
    throw new ParseError(`Unexpected ${describe(t)} at end of line`, t.line, t.column);
  }

  // --- statements ----------------------------------------------------------

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.atEnd()) {
      const t = this.peek();
      if (t.type === T.WORD && BLOCK_ENDERS.has(t.value.toLowerCase())) {
        throw new ParseError(
          `'${t.value}' has no matching 'if' or 'repeat'`,
          t.line,
          t.column
        );
      }
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { type: 'Program', body };
  }

  /** Parse statements until `end` or `else`, which the caller consumes. */
  parseBlock(openerLine, openerWord) {
    const body = [];
    this.skipNewlines();
    for (;;) {
      const t = this.peek();
      if (t.type === T.EOF) {
        throw new ParseError(
          `'${openerWord}' on line ${openerLine} is never closed — add 'end'`,
          t.line,
          t.column
        );
      }
      if (t.type === T.WORD && BLOCK_ENDERS.has(t.value.toLowerCase())) return body;
      body.push(this.parseStatement());
      this.skipNewlines();
    }
  }

  parseStatement() {
    const t = this.peek();
    if (t.type !== T.WORD) {
      throw new ParseError(`Expected a command, found ${describe(t)}`, t.line, t.column);
    }
    const word = t.value.toLowerCase();

    // Assignment is the only statement whose second token decides it.
    if (this.peek(1).type === T.OP && this.peek(1).value === '=') {
      return this.parseAssignment();
    }

    switch (word) {
      case 'if':
        return this.parseIf();
      case 'repeat':
        return this.parseRepeat();
      case 'stop':
        this.next();
        this.endStatement();
        return { type: 'Stop', line: t.line };
      case 'exit':
        this.next();
        this.expectWord('repeat', "after 'exit'");
        this.endStatement();
        return { type: 'ExitRepeat', line: t.line };
      case 'next':
        // `next repeat` is a loop control; `next` alone is not a command.
        if (this.isWord('repeat', 1)) {
          this.next();
          this.next();
          this.endStatement();
          return { type: 'NextRepeat', line: t.line };
        }
        throw new ParseError(
          "'next' must be followed by 'repeat' — did you mean 'go next'?",
          t.line,
          t.column
        );
      default:
        return this.parseCommand();
    }
  }

  parseAssignment() {
    const nameTok = this.next();
    if (!/^[A-Za-z_]\w*$/.test(nameTok.value)) {
      throw new ParseError(
        `'${nameTok.value}' is not a valid variable name`,
        nameTok.line,
        nameTok.column
      );
    }
    this.next(); // '='
    const value = this.parseExpression();
    this.endStatement();
    return { type: 'Assign', target: nameTok.value, value, line: nameTok.line };
  }

  parseIf() {
    const open = this.next(); // 'if'
    const branches = [];
    let cond = this.parseCondition();
    this.endStatement();
    let body = this.parseBlock(open.line, 'if');
    branches.push({ cond, body });

    let elseBody = null;
    for (;;) {
      if (this.isWord('else')) {
        this.next();
        if (this.isWord('if')) {
          this.next();
          cond = this.parseCondition();
          this.endStatement();
          body = this.parseBlock(open.line, 'if');
          branches.push({ cond, body });
          continue;
        }
        this.endStatement();
        elseBody = this.parseBlock(open.line, 'if');
        this.expectWord('end', "to close 'if'");
        this.endStatement();
        break;
      }
      this.expectWord('end', "to close 'if'");
      this.endStatement();
      break;
    }
    return { type: 'If', branches, elseBody, line: open.line };
  }

  parseRepeat() {
    const open = this.next(); // 'repeat'
    let kind = 'forever';
    let expr = null;

    if (this.peek().type === T.NEWLINE) {
      kind = 'forever';
    } else if (this.acceptWord('forever')) {
      kind = 'forever';
    } else if (this.acceptWord('while')) {
      kind = 'while';
      expr = this.parseCondition();
    } else if (this.acceptWord('until')) {
      kind = 'until';
      expr = this.parseCondition();
    } else {
      // `repeat 10` / `repeat 10 times`
      kind = 'count';
      expr = this.parseExpression();
      this.acceptWord('times');
    }
    this.endStatement();
    const body = this.parseBlock(open.line, 'repeat');
    this.expectWord('end', "to close 'repeat'");
    this.endStatement();
    return { type: 'Repeat', kind, expr, body, line: open.line };
  }

  // --- commands ------------------------------------------------------------

  parseCommand() {
    const t = this.next();
    const cmd = t.value.toLowerCase();
    const line = t.line;

    switch (cmd) {
      case 'go':
        return this.finish(this.parseGo(line));
      case 'play':
        this.expectWord('sound', "after 'play'");
        return this.finish({ type: 'PlaySound', name: this.parseName('a sound name'), line });
      case 'show':
        this.expectWord('button', "after 'show'");
        return this.finish({ type: 'ShowButton', id: this.parseName('a button id'), line });
      case 'hide':
        this.expectWord('button', "after 'hide'");
        return this.finish({ type: 'HideButton', id: this.parseName('a button id'), line });
      case 'trigger':
        this.expectWord('effect', "after 'trigger'");
        return this.finish({ type: 'TriggerEffect', name: this.parseName('an effect name'), line });
      case 'move':
        return this.finish(this.parseMove(line));
      case 'wait':
        return this.finish(this.parseWait(line));
      case 'ask':
        return this.finish({ type: 'Ask', prompt: this.parsePromptList(), line });
      case 'say':
        return this.finish({ type: 'Say', prompt: this.parsePromptList(), line });
      case 'yesno':
        return this.finish({ type: 'YesNo', prompt: this.parsePromptList(), line });
      case 'speak':
        // The lexer already captured everything after 'speak' up to the line
        // break as one raw STRING token (see lexer.js) — quotes stripped if
        // the whole argument was quoted, verbatim otherwise. There is nothing
        // left on the line to parse as an expression.
        return this.finish({
          type: 'Speak',
          text: this.parseRawLine('Expected text to speak'),
          line,
        });
      case 'speaker':
        // Same raw capture as 'speak'. What the text means — a voice name, a
        // words-per-minute number, or both — is decided in the interpreter,
        // not here: a trailing numeric token is the rate and everything
        // before it is the voice name, which needs the whole raw string
        // (multi-word voices like "Bad News" would be lost to tokenizing).
        return this.finish({
          type: 'SetVoice',
          raw: this.parseRawLine(
            "Expected a voice name and/or a words-per-minute number after 'speaker'"
          ),
          line,
        });
      default:
        throw new ParseError(`Unknown command '${t.value}'`, t.line, t.column);
    }
  }

  finish(node) {
    this.endStatement();
    return node;
  }

  parseGo(line) {
    const t = this.peek();
    if (t.type !== T.WORD) {
      throw new ParseError(
        `Expected 'next', 'prev', 'first', 'last', or 'card' after 'go', found ${describe(t)}`,
        t.line,
        t.column
      );
    }
    const w = t.value.toLowerCase();
    if (w === 'next' || w === 'first' || w === 'last') {
      this.next();
      return { type: 'Go', target: { kind: w }, line };
    }
    if (w === 'prev' || w === 'previous') {
      this.next();
      return { type: 'Go', target: { kind: 'prev' }, line };
    }
    if (w === 'card') {
      this.next();
      const nameTok = this.peek();
      if (nameTok.type === T.NUMBER) {
        this.next();
        return { type: 'Go', target: { kind: 'number', value: parseInt(nameTok.value, 10) }, line };
      }
      if (nameTok.type === T.WORD || nameTok.type === T.STRING) {
        this.next();
        return { type: 'Go', target: { kind: 'name', value: nameTok.value }, line };
      }
      throw new ParseError(
        `Expected a card name or number after 'go card', found ${describe(nameTok)}`,
        nameTok.line,
        nameTok.column
      );
    }
    throw new ParseError(
      `Unknown destination '${t.value}' — expected next, prev, first, last, or card`,
      t.line,
      t.column
    );
  }

  parseMove(line) {
    const id = this.parseName('a button id');
    const dirTok = this.peek();
    if (dirTok.type !== T.WORD || !DIRECTIONS.has(dirTok.value.toLowerCase())) {
      throw new ParseError(
        `Expected left, right, up, or down, found ${describe(dirTok)}`,
        dirTok.line,
        dirTok.column
      );
    }
    const direction = this.next().value.toLowerCase();
    this.expectWord('by', 'in a move command');

    // A percent literal changes the meaning of the amount, so note it before
    // the token is folded into an expression.
    const amountTok = this.peek();
    const isPercent = amountTok.type === T.NUMBER && amountTok.value.endsWith('%');
    const amount = this.parseExpression();

    this.expectWord('in', 'in a move command');
    const duration = this.parseExpression();
    this.acceptWord('seconds');
    this.acceptWord('second');

    return { type: 'Move', id, direction, amount, isPercent, duration, line };
  }

  parseWait(line) {
    if (this.acceptWord('until')) {
      this.expectWord('done', "after 'wait until'");
      return { type: 'WaitForSounds', line };
    }
    const seconds = this.parseExpression();
    this.acceptWord('seconds');
    this.acceptWord('second');
    return { type: 'Wait', seconds, line };
  }

  /** Consume the raw STRING token a raw-line command (speak/speaker) captured. */
  parseRawLine(message) {
    const t = this.peek();
    if (t.type !== T.STRING) {
      throw new ParseError(message, t.line, t.column);
    }
    this.next();
    if (!t.value.trim()) {
      throw new ParseError(message, t.line, t.column);
    }
    return t.value;
  }

  /**
   * A literal name argument: button ids, card names, sound names, effects.
   * These are not variable references — `play sound explosion` names the sound
   * "explosion" even if a variable of that name exists, matching the original.
   */
  parseName(what) {
    const t = this.peek();
    if (t.type === T.WORD || t.type === T.STRING || t.type === T.NUMBER) {
      this.next();
      return t.value;
    }
    throw new ParseError(`Expected ${what}, found ${describe(t)}`, t.line, t.column);
  }

  /**
   * Prompt arguments for say/ask/yesno. The original resolved each whitespace-
   * separated token and joined the results with spaces, so `say "Hi" name`
   * printed "Hi Alice". Parsing a list of expressions preserves that while also
   * allowing a single richer expression like `say "Score: " & score`.
   */
  parsePromptList() {
    const parts = [];
    while (this.peek().type !== T.NEWLINE && this.peek().type !== T.EOF) {
      parts.push(this.parseExpression());
    }
    if (parts.length === 0) {
      const t = this.peek();
      throw new ParseError('Expected a message to display', t.line, t.column);
    }
    return parts;
  }

  // --- conditions and expressions ------------------------------------------

  /**
   * Conditions add two phrase forms the expression grammar cannot express:
   * `<button> is [not] visible` and `card is [not] <name>`.
   */
  parseCondition() {
    // `card is [not] <name|number>`
    if (this.isWord('card') && this.isWord('is', 1)) {
      const line = this.peek().line;
      this.next();
      this.next();
      const negate = this.acceptWord('not');
      const t = this.peek();
      if (t.type === T.NUMBER) {
        this.next();
        return { type: 'CardIs', target: { kind: 'number', value: parseInt(t.value, 10) }, negate, line };
      }
      if (t.type === T.WORD || t.type === T.STRING) {
        this.next();
        return { type: 'CardIs', target: { kind: 'name', value: t.value }, negate, line };
      }
      throw new ParseError(`Expected a card name or number, found ${describe(t)}`, t.line, t.column);
    }

    // `<button> is [not] visible`
    if (this.peek().type === T.WORD && this.isWord('is', 1)) {
      const save = this.pos;
      const idTok = this.next();
      this.next(); // 'is'
      const negate = this.acceptWord('not');
      if (this.acceptWord('visible')) {
        return { type: 'IsVisible', id: idTok.value, negate, line: idTok.line };
      }
      this.pos = save; // not the visibility form — fall through to an expression
    }

    return this.parseExpression();
  }

  parseExpression() {
    return this.parseCompare();
  }

  parseCompare() {
    const left = this.parseConcat();
    const t = this.peek();
    if (t.type === T.OP && ['>', '<', '>=', '<=', '==', '!='].includes(t.value)) {
      this.next();
      const right = this.parseConcat();
      return { type: 'Compare', op: t.value, left, right, line: t.line };
    }
    // A single '=' in expression position is a common slip for '=='.
    if (t.type === T.OP && t.value === '=') {
      throw new ParseError("Use '==' to compare, '=' assigns", t.line, t.column);
    }
    return left;
  }

  parseConcat() {
    let left = this.parseAdditive();
    while (this.peek().type === T.OP && this.peek().value === '&') {
      const op = this.next();
      const right = this.parseAdditive();
      left = { type: 'Binary', op: '&', left, right, line: op.line };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseTerm();
    while (this.peek().type === T.OP && ['+', '-'].includes(this.peek().value)) {
      const op = this.next();
      const right = this.parseTerm();
      left = { type: 'Binary', op: op.value, left, right, line: op.line };
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    while (this.peek().type === T.OP && ['*', '/'].includes(this.peek().value)) {
      const op = this.next();
      const right = this.parseUnary();
      left = { type: 'Binary', op: op.value, left, right, line: op.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === T.OP && t.value === '-') {
      this.next();
      return { type: 'Unary', op: '-', operand: this.parseUnary(), line: t.line };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.next();
    if (t.type === T.NUMBER) {
      const isPercent = t.value.endsWith('%');
      const raw = isPercent ? t.value.slice(0, -1) : t.value;
      return { type: 'Num', value: parseFloat(raw) || 0, percent: isPercent, line: t.line };
    }
    if (t.type === T.STRING) {
      return { type: 'Str', value: t.value, line: t.line };
    }
    if (t.type === T.WORD) {
      return { type: 'Var', name: t.value, line: t.line, column: t.column };
    }
    if (t.type === T.LPAREN) {
      const inner = this.parseExpression();
      const close = this.peek();
      if (close.type !== T.RPAREN) {
        throw new ParseError(`Expected ')', found ${describe(close)}`, close.line, close.column);
      }
      this.next();
      return inner;
    }
    throw new ParseError(`Expected a value, found ${describe(t)}`, t.line, t.column);
  }
}

function describe(t) {
  switch (t.type) {
    case T.EOF:
      return 'end of script';
    case T.NEWLINE:
      return 'end of line';
    case T.STRING:
      return `text "${t.value}"`;
    default:
      return `'${t.value}'`;
  }
}
