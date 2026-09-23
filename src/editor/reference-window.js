/* Entry point for the standalone reference window (see reference.html). A
   single static render plus Escape-to-close, matching every other floating
   surface in the app. */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { buildReference } from './reference.js';

document.getElementById('reference-page').appendChild(buildReference());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') getCurrentWindow().close();
});
