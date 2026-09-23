import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interpreter } from '../src/runtime/interpreter.js';
import { tryParse } from '../src/runtime/parser.js';
import { MockHost } from './mock-host.js';

/** Run a script and return {host, vars}. */
async function run(src, opts = {}, globals = {}) {
  const host = new MockHost(opts);
  const interp = new Interpreter(host, globals);
  await interp.run(src, opts.selfId ?? null);
  return { host, vars: globals };
}

// --- parity with the web version ------------------------------------------

test('navigation commands', async () => {
  const { host } = await run('go next');
  assert.deepEqual(host.log, ['go:next']);

  const b = await run('go card card_b');
  assert.deepEqual(b.host.log, ['go:name:card_b']);

  const c = await run('go card 3');
  assert.deepEqual(c.host.log, ['go:number:3']);

  for (const [src, want] of [
    ['go prev', 'go:prev'],
    ['go previous', 'go:prev'],
    ['go first', 'go:first'],
    ['go last', 'go:last'],
  ]) {
    const r = await run(src);
    assert.deepEqual(r.host.log, [want], src);
  }
});

test('comments and blank lines are ignored', async () => {
  const { host } = await run('-- a comment\n\n  go next  -- trailing\n');
  assert.deepEqual(host.log, ['go:next']);
});

test('this resolves to the running button', async () => {
  const { host } = await run('hide button this', { selfId: 'btn_7', buttons: { btn_7: true } });
  assert.deepEqual(host.log, ['hide:btn_7']);
});

test('move parses pixels and percentages', async () => {
  const px = await run('move this right by 40 in 2 seconds', { selfId: 'b1' });
  assert.deepEqual(px.host.log, ['move:b1:right:40:2']);

  const pct = await run('move this left by 50% in 1 seconds', { selfId: 'b1' });
  assert.deepEqual(pct.host.log, ['move:b1:left:50%:1']);
});

test('wait until done and wait n seconds', async () => {
  const { host } = await run('play sound explosion\nwait until done');
  assert.deepEqual(host.log, ['sound:explosion', 'waitSounds']);
});

test('variables and arithmetic', async () => {
  const { vars } = await run('score = 0\nscore = score + 10\nlives = 3 - 1\ndamage = 4 * 2\nhalf = 10 / 4');
  assert.equal(vars.score, 10);
  assert.equal(vars.lives, 2);
  assert.equal(vars.damage, 8);
  assert.equal(vars.half, 2.5);
});

test('division by zero yields 0 rather than Infinity', async () => {
  const { vars } = await run('x = 5 / 0');
  assert.equal(vars.x, 0);
});

test('string concatenation with & and +', async () => {
  const { vars } = await run('name = "Alice"\ngreeting = "Hello " & name\nlabel = "Score: " & 42');
  assert.equal(vars.greeting, 'Hello Alice');
  assert.equal(vars.label, 'Score: 42');
});

test('if / else / end', async () => {
  const hi = await run('score = 150\nif score > 100\n  go card bonus\nelse\n  go card normal\nend', {}, {});
  assert.deepEqual(hi.host.log, ['go:name:bonus']);

  const lo = await run('score = 5\nif score > 100\n  go card bonus\nelse\n  go card normal\nend', {}, {});
  assert.deepEqual(lo.host.log, ['go:name:normal']);
});

test('nested if blocks skip correctly', async () => {
  const src = [
    'a = 0',
    'if a == 1',
    '  if a == 1',
    '    say "inner"',
    '  end',
    '  say "outer"',
    'else',
    '  say "else branch"',
    'end',
  ].join('\n');
  const { host } = await run(src);
  assert.deepEqual(host.log, ['say:else branch']);
});

test('button visibility conditions', async () => {
  const vis = await run('if this is visible\n  play sound whoosh\nend', {
    selfId: 'b1',
    buttons: { b1: true },
  });
  assert.deepEqual(vis.host.log, ['sound:whoosh']);

  const notVis = await run('if this is not visible\n  play sound glass\nend', {
    selfId: 'b1',
    buttons: { b1: false },
  });
  assert.deepEqual(notVis.host.log, ['sound:glass']);
});

test('card is / card is not conditions', async () => {
  const yes = await run('if card is card_a\n  go next\nend', { cardName: 'card_a' });
  assert.deepEqual(yes.host.log, ['go:next']);

  const no = await run('if card is not card_z\n  go next\nend', { cardName: 'card_a' });
  assert.deepEqual(no.host.log, ['go:next']);
});

test('text objects are read and written by name', async () => {
  const { host } = await run('text_1 = "New content"\nmsg = text_1', { texts: { text_1: 'old' } });
  assert.equal(host.texts.get('text_1'), 'New content');
});

test('text object assignment takes precedence over variables', async () => {
  const { host, vars } = await run('text_1 = 99', { texts: { text_1: '' } });
  assert.equal(host.texts.get('text_1'), '99');
  assert.equal(vars.text_1, undefined);
});

test('ask stores into answer', async () => {
  const { host, vars } = await run('ask "What is your name?"\nname = answer', {
    answers: ['Alice'],
  });
  assert.deepEqual(host.log, ['ask:What is your name?']);
  assert.equal(vars.name, 'Alice');
});

test('yesno stores 1 or 0 into answer', async () => {
  const { vars } = await run('yesno "Play again?"', { answers: [1] });
  assert.equal(vars.answer, 1);
});

test('say joins multiple arguments with spaces, as the web version did', async () => {
  const { host } = await run('say "Hello" name', {}, { name: 'Bob' });
  assert.deepEqual(host.log, ['say:Hello Bob']);
});

test('stop halts the script', async () => {
  const { host } = await run('play sound click\nstop\nplay sound beep');
  assert.deepEqual(host.log, ['sound:click']);
});

test('go halts the script', async () => {
  const { host } = await run('go next\nplay sound beep');
  assert.deepEqual(host.log, ['go:next']);
});

test('effects', async () => {
  const { host } = await run('trigger effect shake\ntrigger effect wobble');
  assert.deepEqual(host.log, ['fx:shake', 'fx:wobble']);
});

test('speak with a quoted argument', async () => {
  const { host } = await run('speak "hello there"');
  assert.deepEqual(host.log, ['speak:hello there']);
});

test('speak with a bare, unquoted argument', async () => {
  const { host } = await run('speak hello there');
  assert.deepEqual(host.log, ['speak:hello there']);
});

test('speak captures punctuation the tokenizer otherwise rejects', async () => {
  const { host } = await run('speak Hello, how are you?');
  assert.deepEqual(host.log, ['speak:Hello, how are you?']);
});

test('speak text is not evaluated as an expression', async () => {
  // Raw capture: & and quotes inside a bare (unquoted) argument are spoken
  // literally, not treated as concatenation or nested strings.
  const { host } = await run('speak score & lives');
  assert.deepEqual(host.log, ['speak:score & lives']);
});

test('speak with no text is a parse error', async () => {
  const { host } = await run('speak');
  assert.equal(host.log.length, 0);
  assert.match(host.errors[0].message, /Expected text to speak/);
});

test('a comment on the line after speak is still recognised', async () => {
  // speak's raw capture only applies to its own line; scripts around it parse
  // normally.
  const { host } = await run('speak first line\n-- a comment\nspeak second line');
  assert.deepEqual(host.log, ['speak:first line', 'speak:second line']);
});

test('speaker with a voice name only', async () => {
  const { host } = await run('speaker Zarvox');
  assert.deepEqual(host.log, ['voice:Zarvox:_']);
});

test('speaker with a rate-only, numeric invocation', async () => {
  const { host } = await run('speaker 200');
  assert.deepEqual(host.log, ['voice:_:200']);
});

test('speaker with both a voice name and a rate', async () => {
  const { host } = await run('speaker Alex 300');
  assert.deepEqual(host.log, ['voice:Alex:300']);
});

test('speaker preserves a multi-word voice name', async () => {
  const { host } = await run('speaker Bad News');
  assert.deepEqual(host.log, ['voice:Bad News:_']);
});

test('speaker with a multi-word voice name and a rate', async () => {
  const { host } = await run('speaker Bad News 220');
  assert.deepEqual(host.log, ['voice:Bad News:220']);
});

test('speaker is case-preserving — case-insensitive matching is the host\'s job', async () => {
  const { host } = await run('speaker zarvox');
  assert.deepEqual(host.log, ['voice:zarvox:_']);
});

test('speaker with no argument is a parse error', async () => {
  const { host } = await run('speaker');
  assert.equal(host.log.length, 0);
  assert.match(host.errors[0].message, /Expected a voice name.*after 'speaker'/);
});

test('speaker and speak compose in a script', async () => {
  const { host } = await run('speaker Zarvox 220\nspeak "Hello there"');
  assert.deepEqual(host.log, ['voice:Zarvox:220', 'speak:Hello there']);
});

// --- type errors ----------------------------------------------------------

test('comparing a number with text reports an error', async () => {
  const { host } = await run('if 5 == "five"\n  go next\nend');
  assert.equal(host.log.length, 0);
  assert.match(host.errors[0].message, /Cannot compare/);
});

test('ordering text with > reports an error', async () => {
  const { host } = await run('if "a" > 1\n  go next\nend');
  assert.match(host.errors[0].message, /Cannot use >/);
});

// --- extended language (strict superset) ----------------------------------

test('repeat n times', async () => {
  const { vars } = await run('score = 0\nrepeat 3\n  score = score + 1\nend');
  assert.equal(vars.score, 3);

  const times = await run('score = 0\nrepeat 4 times\n  score = score + 2\nend');
  assert.equal(times.vars.score, 8);
});

test('repeat while', async () => {
  const { vars } = await run('score = 0\nrepeat while score < 10\n  score = score + 3\nend');
  assert.equal(vars.score, 12);
});

test('repeat until', async () => {
  const { vars } = await run('n = 0\nrepeat until n >= 5\n  n = n + 1\nend');
  assert.equal(vars.n, 5);
});

test('exit repeat and next repeat', async () => {
  const exit = await run('n = 0\nrepeat 100\n  n = n + 1\n  if n == 4\n    exit repeat\n  end\nend');
  assert.equal(exit.vars.n, 4);

  const skip = await run('hits = 0\nn = 0\nrepeat 5\n  n = n + 1\n  if n == 3\n    next repeat\n  end\n  hits = hits + 1\nend');
  assert.equal(skip.vars.hits, 4);
});

test('else if chains', async () => {
  const src = (s) =>
    `score = ${s}\nif score > 100\n  go card gold\nelse if score > 50\n  go card silver\nelse\n  go card bronze\nend`;
  assert.deepEqual((await run(src(150))).host.log, ['go:name:gold']);
  assert.deepEqual((await run(src(75))).host.log, ['go:name:silver']);
  assert.deepEqual((await run(src(10))).host.log, ['go:name:bronze']);
});

test('multi-operand expressions with precedence and parens', async () => {
  const a = await run('x = 2 + 3 * 4');
  assert.equal(a.vars.x, 14);

  const b = await run('base = 5\nbonus = 3\ntotal = (base + bonus) * 2');
  assert.equal(b.vars.total, 16);

  const c = await run('x = -3 + 10');
  assert.equal(c.vars.x, 7);
});

test('runaway loop is caught by the step budget', async () => {
  const host = new MockHost();
  const interp = new Interpreter(host, {});
  interp.stepLimit = 500;
  await interp.run('repeat forever\n  x = 1\nend');
  assert.match(host.errors[0].message, /exceeded 500 steps/);
});

// --- parse errors ---------------------------------------------------------

test('parse errors carry a line number', async () => {
  for (const [src, pattern] of [
    ['go next\nglorp 3', /Unknown command 'glorp'/],
    ['if x > 1\n  go next', /never closed/],
    ['say "unterminated', /Unterminated string/],
    ['end', /no matching/],
    ['if x = 1\n  go next\nend', /Use '=='/],
    ['move this sideways by 4 in 1', /Expected left, right, up, or down/],
  ]) {
    const { error } = tryParse(src);
    assert.ok(error, `expected a parse error for: ${src}`);
    assert.match(error.message, pattern);
    assert.ok(error.line >= 1, 'error carries a line number');
  }
});

test('runtime surfaces parse errors rather than throwing', async () => {
  const { host } = await run('glorp');
  assert.equal(host.log.length, 0);
  assert.match(host.errors[0].message, /Line 1/);
});
