/* ---------------------------------------------------------------------------
   Interpreter.

   Walks the AST produced by parser.js. Every side effect goes through the
   `host` object rather than the DOM, which is what lets one engine drive both
   the in-app play window and the standalone HTML export. The web version had
   two hand-maintained copies of this logic that had already drifted apart.

   Host interface (all may return promises):

     goCard(target)                  target = {kind:'next'|'prev'|'first'|'last'
                                              |'name'|'number', value?}
     playSound(name)                 resolves when the sound finishes
     waitForSounds()                 resolves when all in-flight sounds finish
     showButton(id) / hideButton(id)
     isButtonVisible(id) -> boolean
     moveButton(id, dir, amount, isPercent, seconds)
     triggerEffect(name)
     ask(prompt) -> string
     say(prompt)
     yesno(prompt) -> 1 | 0
     speak(text)                     resolves when speech finishes (or immediately if unsupported)
     setVoice(name, rate)            name/rate are null when that part wasn't specified
     getText(name) -> string | null  null when no such text object
     setText(name, value) -> boolean true if a text object was updated
     currentCardName() -> string
     currentCardNumber() -> number   1-based
     reportError(message, line)
   --------------------------------------------------------------------------- */

import { parse } from './parser.js';

/** Guards against runaway loops. Real loops exist now, so this is generous. */
const DEFAULT_STEP_LIMIT = 200000;

/** How many statements to run before yielding to the event loop. */
const YIELD_INTERVAL = 2000;

/** Signals propagated up through block execution. */
const SIG = { NONE: 0, STOP: 1, EXIT: 2, NEXT: 3, HALT: 4 };

export class RuntimeError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'RuntimeError';
    this.line = line;
  }
}

export class Interpreter {
  /**
   * @param {object} host    effect surface, see module docs
   * @param {object} globals shared variable bag, persists across scripts in a
   *                         play session (the web version reset it per session)
   */
  constructor(host, globals = {}) {
    this.host = host;
    this.globals = globals;
    this.stepLimit = DEFAULT_STEP_LIMIT;
    this.cancelled = false;
  }

  /** Stop a running script, e.g. when the user leaves play mode. */
  cancel() {
    this.cancelled = true;
  }

  /**
   * Parse and run a script.
   * @param {string} src
   * @param {string|null} selfId  button id that `this` refers to
   */
  async run(src, selfId = null) {
    if (!src || !src.trim()) return;
    let ast;
    try {
      ast = parse(src);
    } catch (e) {
      this.host.reportError(`Line ${e.line}: ${e.message}`, e.line);
      return;
    }

    this.selfId = selfId;
    this.steps = 0;
    this.cancelled = false;

    try {
      await this.execBlock(ast.body);
    } catch (e) {
      if (e instanceof RuntimeError) {
        this.host.reportError(
          e.line ? `Line ${e.line}: ${e.message}` : e.message,
          e.line
        );
        return;
      }
      throw e;
    }
  }

  // --- statement execution -------------------------------------------------

  async execBlock(stmts) {
    for (const stmt of stmts) {
      const sig = await this.execStatement(stmt);
      if (sig !== SIG.NONE) return sig;
    }
    return SIG.NONE;
  }

  async execStatement(node) {
    if (this.cancelled) return SIG.HALT;

    // Budget check, plus a periodic yield so a long loop keeps the UI alive.
    if (++this.steps > this.stepLimit) {
      throw new RuntimeError(
        `Script exceeded ${this.stepLimit} steps — check for a loop that never ends`,
        node.line
      );
    }
    if (this.steps % YIELD_INTERVAL === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (this.cancelled) return SIG.HALT;
    }

    switch (node.type) {
      case 'Assign': {
        const value = this.evaluate(node.value);
        // A text object of the same name takes precedence, matching the web
        // version: `text_1 = "hi"` retargets the on-card object, not a variable.
        if (!this.host.setText(node.target, stringify(value))) {
          this.globals[node.target] = value;
        }
        return SIG.NONE;
      }

      case 'If': {
        for (const branch of node.branches) {
          if (truthy(this.evaluate(branch.cond))) {
            return this.execBlock(branch.body);
          }
        }
        if (node.elseBody) return this.execBlock(node.elseBody);
        return SIG.NONE;
      }

      case 'Repeat':
        return this.execRepeat(node);

      case 'Stop':
        return SIG.STOP;
      case 'ExitRepeat':
        return SIG.EXIT;
      case 'NextRepeat':
        return SIG.NEXT;

      case 'Go':
        await this.host.goCard(this.resolveCardTarget(node.target));
        // Navigation runs the destination card's script. Letting the current
        // script continue afterwards would interleave two cards' logic against
        // the same runtime state, so `go` ends the running script. This is a
        // deliberate departure from the web version, which left the old script
        // running against the newly rendered card.
        return SIG.HALT;

      case 'PlaySound':
        await this.host.playSound(this.resolveName(node.name));
        return SIG.NONE;

      case 'WaitForSounds':
        await this.host.waitForSounds();
        return SIG.NONE;

      case 'Wait': {
        const secs = toNumber(this.evaluate(node.seconds));
        if (secs > 0) await sleep(secs * 1000, () => this.cancelled);
        return SIG.NONE;
      }

      case 'ShowButton':
        await this.host.showButton(this.resolveName(node.id));
        return SIG.NONE;
      case 'HideButton':
        await this.host.hideButton(this.resolveName(node.id));
        return SIG.NONE;

      case 'TriggerEffect':
        await this.host.triggerEffect(this.resolveName(node.name));
        return SIG.NONE;

      case 'Move': {
        const amount = toNumber(this.evaluate(node.amount));
        const seconds = toNumber(this.evaluate(node.duration));
        await this.host.moveButton(
          this.resolveName(node.id),
          node.direction,
          amount,
          node.isPercent,
          seconds
        );
        return SIG.NONE;
      }

      case 'Ask':
        this.globals.answer = await this.host.ask(this.buildPrompt(node.prompt));
        return SIG.NONE;

      case 'Say':
        await this.host.say(this.buildPrompt(node.prompt));
        return SIG.NONE;

      case 'YesNo':
        this.globals.answer = await this.host.yesno(this.buildPrompt(node.prompt));
        return SIG.NONE;

      case 'Speak':
        // node.text is already a resolved string captured verbatim by the
        // lexer, not an expression — there is nothing here to evaluate().
        await this.host.speak(node.text);
        return SIG.NONE;

      case 'SetVoice': {
        const { voice, rate } = parseSpeakerArgs(node.raw);
        await this.host.setVoice(voice, rate);
        return SIG.NONE;
      }

      default:
        throw new RuntimeError(`Cannot execute ${node.type}`, node.line);
    }
  }

  async execRepeat(node) {
    let iterations = 0;
    let limit = Infinity;

    if (node.kind === 'count') {
      limit = Math.floor(toNumber(this.evaluate(node.expr)));
      if (!(limit > 0)) return SIG.NONE;
    }

    for (;;) {
      if (this.cancelled) return SIG.HALT;
      if (node.kind === 'count' && iterations >= limit) break;
      if (node.kind === 'while' && !truthy(this.evaluate(node.expr))) break;
      if (node.kind === 'until' && truthy(this.evaluate(node.expr))) break;

      const sig = await this.execBlock(node.body);
      if (sig === SIG.EXIT) break;
      if (sig === SIG.STOP || sig === SIG.HALT) return sig;
      // SIG.NEXT falls through to the next iteration.

      iterations++;
    }
    return SIG.NONE;
  }

  // --- expression evaluation -----------------------------------------------

  evaluate(node) {
    switch (node.type) {
      case 'Num':
        return node.value;
      case 'Str':
        return node.value;

      case 'Var':
        return this.lookup(node.name);

      case 'Unary':
        return -toNumber(this.evaluate(node.operand));

      case 'Binary': {
        const a = this.evaluate(node.left);
        const b = this.evaluate(node.right);
        switch (node.op) {
          case '&':
            return stringify(a) + stringify(b);
          case '+':
            // '+' concatenates when either side is text, matching the web
            // version and JavaScript's own behaviour.
            return typeof a === 'string' || typeof b === 'string'
              ? stringify(a) + stringify(b)
              : a + b;
          case '-':
            return toNumber(a) - toNumber(b);
          case '*':
            return toNumber(a) * toNumber(b);
          case '/': {
            const d = toNumber(b);
            return d === 0 ? 0 : toNumber(a) / d;
          }
          default:
            throw new RuntimeError(`Unknown operator '${node.op}'`, node.line);
        }
      }

      case 'Compare': {
        const a = this.evaluate(node.left);
        const b = this.evaluate(node.right);
        const op = node.op;
        if (op === '==' || op === '!=') {
          // Comparing a number against text is a mistake worth surfacing
          // rather than silently answering false.
          if (typeof a !== typeof b) {
            throw new RuntimeError(
              `Cannot compare ${typeof a} (${stringify(a)}) with ${typeof b} (${stringify(b)}) using ${op}`,
              node.line
            );
          }
          return (op === '==' ? a === b : a !== b) ? 1 : 0;
        }
        if (typeof a === 'string' || typeof b === 'string') {
          throw new RuntimeError(
            `Cannot use ${op} to compare text — use == or != instead`,
            node.line
          );
        }
        const x = toNumber(a);
        const y = toNumber(b);
        const r =
          op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : x <= y;
        return r ? 1 : 0;
      }

      case 'IsVisible': {
        const visible = this.host.isButtonVisible(this.resolveName(node.id));
        return (node.negate ? !visible : visible) ? 1 : 0;
      }

      case 'CardIs': {
        const t = node.target;
        const match =
          t.kind === 'number'
            ? this.host.currentCardNumber() === t.value
            : this.host.currentCardName() === t.value;
        return (node.negate ? !match : match) ? 1 : 0;
      }

      default:
        throw new RuntimeError(`Cannot evaluate ${node.type}`, node.line);
    }
  }

  /**
   * Resolve a bare word to a value. Resolution order matches the web version's
   * `resolveValue()`: text objects shadow variables, and an unknown word that
   * looks numeric becomes a number, otherwise 0.
   */
  lookup(name) {
    if (name.toLowerCase() === 'this' && this.selfId) return this.selfId;

    const text = this.host.getText(name);
    if (text !== null && text !== undefined) return text;

    if (Object.prototype.hasOwnProperty.call(this.globals, name)) {
      return this.globals[name];
    }
    const n = Number(name);
    return name !== '' && !Number.isNaN(n) ? n : 0;
  }

  /** Literal name arguments still honour `this`. */
  resolveName(name) {
    return String(name).toLowerCase() === 'this' && this.selfId ? this.selfId : name;
  }

  resolveCardTarget(target) {
    if (target.kind === 'name') return { kind: 'name', value: this.resolveName(target.value) };
    return target;
  }

  /** Join a prompt's expression list with spaces, as the web version did. */
  buildPrompt(parts) {
    return parts.map((p) => stringify(this.evaluate(p))).join(' ');
  }
}

/**
 * Split a `speaker` command's raw argument into a voice name and/or a
 * words-per-minute rate. A trailing numeric token is the rate; everything
 * before it — if anything — is the voice name, rejoined with spaces so
 * multi-word macOS voices like "Bad News" or "Pipe Organ" survive intact.
 * A single numeric token on its own is rate-only ('speaker 200'), matching
 * `say -r 200`.
 */
function parseSpeakerArgs(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let rate = null;
  if (tokens.length > 0 && /^-?\d+(\.\d+)?$/.test(tokens[tokens.length - 1])) {
    rate = Number(tokens.pop());
  }
  const voice = tokens.length > 0 ? tokens.join(' ') : null;
  return { voice, rate };
}

// --- value helpers ---------------------------------------------------------

function stringify(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    // Trim float noise so `0.1 + 0.2` displays as 0.3, not 0.30000000000000004.
    return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(10)));
  }
  return String(v);
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function truthy(v) {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== '0';
  return Boolean(v);
}

/** Interruptible sleep so `wait` does not outlive play mode. */
function sleep(ms, isCancelled) {
  return new Promise((resolve) => {
    const step = 50;
    let elapsed = 0;
    const tick = () => {
      if (isCancelled() || elapsed >= ms) return resolve();
      elapsed += step;
      setTimeout(tick, Math.min(step, ms - elapsed + step));
    };
    tick();
  });
}

export { stringify, toNumber, truthy };
