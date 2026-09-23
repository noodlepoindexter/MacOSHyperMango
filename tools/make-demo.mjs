/* Builds a demo stack and renders it with the real export pipeline.
   Used to produce a shareable, playable page without launching the app. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExportHtml } from '../src/export/html.js';
import { stripModuleSyntax } from '../src/export/strip.js';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, '..', 'src', 'runtime');
const MODULES = ['lexer.js', 'parser.js', 'interpreter.js', 'audio.js', 'effects.js'];

const bundle = MODULES
  .map((n) => stripModuleSyntax(readFileSync(join(runtimeDir, n), 'utf8')))
  .join('\n');

const png = (name) =>
  'data:image/png;base64,' +
  readFileSync(join(here, '..', 'demo-art', name)).toString('base64');

const stack = {
  projectName: 'Mango Quest',
  variables: { score: 0, lives: 3 },
  customSounds: {},
  cards: [
    {
      name: 'start',
      script: '',
      imageData: png('card1.png'),
      textObjects: [
        {
          id: 'text_1', x: 90, y: 90, w: 700, h: 90,
          content: 'Mango Quest', fontFamily: 'Georgia, serif',
          fontSize: 68, color: '#7a2f10',
        },
        {
          id: 'text_2', x: 92, y: 196, w: 700, h: 44,
          content: 'A tiny stack built with the desktop app',
          fontFamily: 'system-ui, sans-serif', fontSize: 24, color: '#8a5a3a',
        },
      ],
      buttons: [
        {
          id: 'btn_1', nameId: 'begin', label: 'Begin →',
          x: 92, y: 280, w: 190, h: 52,
          goto: 0, sound: '', invisible: false, isCanvas: false,
          canvasData: null, effect: '',
          script: 'play sound chime\ngo card orchard',
        },
      ],
    },
    {
      name: 'orchard',
      script: 'text_score = "Score: " & score',
      imageData: png('card2.png'),
      textObjects: [
        {
          id: 'text_score', x: 90, y: 80, w: 420, h: 44,
          content: 'Score: 0', fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 30, color: '#1c3d1f',
        },
        {
          id: 'text_hint', x: 90, y: 132, w: 620, h: 36,
          content: 'Pick the mangoes. Loops and conditionals drive this card.',
          fontFamily: 'system-ui, sans-serif', fontSize: 20, color: '#3c5a3f',
        },
      ],
      buttons: [
        {
          id: 'btn_2', nameId: 'pick', label: 'Pick a mango',
          x: 90, y: 620, w: 210, h: 52,
          goto: 0, sound: '', invisible: false, isCanvas: false,
          canvasData: null, effect: '',
          // Exercises: loop, arithmetic, text assignment, conditional, navigation
          script: [
            'play sound click',
            'repeat 5',
            '  score = score + 4',
            'end',
            'text_score = "Score: " & score',
            'if score >= 40',
            '  trigger effect flash',
            '  go card win',
            'else if score >= 20',
            '  trigger effect wobble',
            'else',
            '  trigger effect shake',
            'end',
          ].join('\n'),
        },
        {
          id: 'btn_3', nameId: 'shake_it', label: 'Ask me something',
          x: 320, y: 620, w: 230, h: 52,
          goto: 0, sound: '', invisible: false, isCanvas: false,
          canvasData: null, effect: '',
          script: [
            'ask "What should I call you?"',
            'who = answer',
            'say "Nice to meet you, " & who',
          ].join('\n'),
        },
        {
          id: 'btn_4', nameId: 'back', label: '← Back',
          x: 570, y: 620, w: 140, h: 52,
          goto: 1, sound: '', invisible: false, isCanvas: false,
          canvasData: null, effect: '', script: '',
        },
      ],
    },
    {
      name: 'win',
      script: 'text_final = "Final score: " & score',
      imageData: png('card3.png'),
      textObjects: [
        {
          id: 'text_win', x: 90, y: 300, w: 800, h: 90,
          content: 'Basket full!', fontFamily: 'Georgia, serif',
          fontSize: 62, color: '#7a2f10',
        },
        {
          id: 'text_final', x: 92, y: 396, w: 600, h: 44,
          content: 'Final score: 0', fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 28, color: '#8a5a3a',
        },
      ],
      buttons: [
        {
          id: 'btn_5', nameId: 'again', label: 'Play again',
          x: 92, y: 470, w: 180, h: 52,
          goto: 0, sound: '', invisible: false, isCanvas: false,
          canvasData: null, effect: '',
          script: 'score = 0\nplay sound whoosh\ngo card start',
        },
      ],
    },
  ],
};

const html = buildExportHtml(stack, bundle);
const out = join(here, '..', 'demo', 'mango-quest.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
