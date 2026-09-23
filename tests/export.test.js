/* The exported HTML page runs the same runtime modules the app does,
   concatenated into one classic script. These tests prove that concatenation
   still produces working JavaScript — if a runtime module ever adopts module
   syntax the transform cannot handle, this fails rather than the export
   silently shipping a broken page. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { stripModuleSyntax, findUnsupportedSyntax } from '../src/export/strip.js';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, '..', 'src', 'runtime');

// Same order bundle.js uses.
const MODULES = ['lexer.js', 'parser.js', 'interpreter.js', 'audio.js', 'effects.js'];

function read(name) {
  return readFileSync(join(runtimeDir, name), 'utf8');
}

function buildBundle() {
  return MODULES.map((n) => stripModuleSyntax(read(n))).join('\n');
}

test('every runtime module uses syntax the export transform supports', () => {
  for (const name of MODULES) {
    const problems = findUnsupportedSyntax(read(name));
    assert.deepEqual(problems, [], `${name} uses unsupported module syntax: ${problems}`);
  }
});

test('the concatenated bundle is valid JavaScript', () => {
  const src = buildBundle();
  assert.doesNotThrow(() => new vm.Script(src), 'bundle failed to compile');
});

test('the bundle exposes the classes the exported player calls', () => {
  const ctx = vm.createContext({ window: {}, document: undefined, setTimeout, console });
  new vm.Script(buildBundle() + '\n;({Interpreter, AudioEngine, triggerEffect, parse});')
    .runInContext(ctx);

  const result = new vm.Script(
    'typeof Interpreter + "," + typeof AudioEngine + "," + typeof triggerEffect + "," + typeof parse'
  ).runInContext(ctx);
  assert.equal(result, 'function,function,function,function');
});

test('a script runs end to end inside the bundled runtime', async () => {
  const ctx = vm.createContext({ setTimeout, console, window: {} });
  new vm.Script(buildBundle()).runInContext(ctx);

  // Drive the bundled Interpreter with a recording host, exactly as the
  // exported player would.
  ctx.hostLog = [];
  const script = `
    var log = hostLog;
    var host = {
      goCard: function (t) { log.push('go:' + t.kind); },
      playSound: function (n) { log.push('sound:' + n); },
      waitForSounds: function () {},
      showButton: function () {}, hideButton: function () {},
      isButtonVisible: function () { return true; },
      moveButton: function () {}, triggerEffect: function (n) { log.push('fx:' + n); },
      ask: function () { return ''; }, say: function (p) { log.push('say:' + p); },
      yesno: function () { return 1; },
      getText: function () { return null; }, setText: function () { return false; },
      currentCardName: function () { return 'card_a'; },
      currentCardNumber: function () { return 1; },
      reportError: function (m) { log.push('err:' + m); }
    };
    var vars = {};
    var interp = new Interpreter(host, vars);
    interp.run('score = 0\\nrepeat 3\\n  score = score + 2\\nend\\nif score == 6\\n  say "ok"\\n  trigger effect shake\\nend', null)
      .then(function () { result = JSON.stringify({ log: log, score: vars.score }); });
  `;
  new vm.Script(script).runInContext(ctx);
  // Let the interpreter's promise chain settle.
  await new Promise((r) => setTimeout(r, 50));

  const out = JSON.parse(ctx.result);
  assert.equal(out.score, 6, 'loop executed inside the bundle');
  assert.deepEqual(out.log, ['say:ok', 'fx:shake']);
});

test('stripModuleSyntax leaves ordinary code untouched', () => {
  const src = [
    "import { a } from './x.js';",
    'export const N = 5;',
    'export function f(x) { return x * N; }',
    'const notAnExport = "export const trap";',
    'export class C {}',
    'export { a, f };',
  ].join('\n');
  const out = stripModuleSyntax(src);
  assert.ok(!/^\s*import\b/m.test(out));
  assert.ok(!/^\s*export\b/m.test(out));
  assert.match(out, /const N = 5;/);
  assert.match(out, /function f\(x\) \{ return x \* N; \}/);
  assert.match(out, /class C \{\}/);
  // A string that merely contains the word must survive.
  assert.match(out, /const notAnExport = "export const trap";/);
});
