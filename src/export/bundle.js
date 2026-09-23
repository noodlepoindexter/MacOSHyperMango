/* ---------------------------------------------------------------------------
   Inlining the runtime into an exported page.

   The web version shipped a second, hand-minified copy of its interpreter
   inside the export template, and the two had already drifted apart by the time
   this port started. Here the exported page gets the *same* runtime modules the
   app itself runs, imported as source text at build time and concatenated into
   one classic script.

   The transform is deliberately narrow: these modules only ever use named
   `export` declarations and relative `import { … } from './x.js'`, so stripping
   both and concatenating in dependency order is sufficient. `tests/export.test.js`
   evaluates the result and runs a script through it, so if a module ever adopts
   a form this cannot handle, that test fails rather than the export silently
   shipping broken JavaScript.
   --------------------------------------------------------------------------- */

import { stripModuleSyntax } from './strip.js';
import lexerSrc from '../runtime/lexer.js?raw';
import parserSrc from '../runtime/parser.js?raw';
import interpreterSrc from '../runtime/interpreter.js?raw';
import audioSrc from '../runtime/audio.js?raw';
import effectsSrc from '../runtime/effects.js?raw';

/** Dependency order matters: each module may only reference earlier ones. */
const MODULES = [
  ['lexer.js', lexerSrc],
  ['parser.js', parserSrc],
  ['interpreter.js', interpreterSrc],
  ['audio.js', audioSrc],
  ['effects.js', effectsSrc],
];

/** Concatenate the runtime into a single classic script body. */
export function buildRuntimeBundle() {
  return MODULES.map(([name, src]) => `/* --- ${name} --- */\n${stripModuleSyntax(src)}`).join(
    '\n'
  );
}
