/* Inline SVG icons. Stroke-based and currentColor-driven so they invert
   correctly on selected toolbar buttons and in dark mode. */

const svg = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" ${opts}>${body}</svg>`;

const ERASER_BODY = 'M717.47,39.33c-10.57,12.39-105.53,105.11-108.89,108.39-.1.09-2.5,2.35-2.89,3.34-1.77,4.49-1.96,5.74-1.99,6.27-.51,8.91-6.26,36.67-7.83,39.13-.08.13-.5.73-.68,1.62-.14.7-.05,1.18,0,1.89.1,1.47-.09,2.53-.09,2.71-.42,8.16-.64,12.24,56.67,38.44,0,0,4.79.49,8.3,0,0,0,3.66-.52,7.94-3.25,15.22-9.72,90.53-101.24,95.37-104.75.16-.11,1.03-.7,1.62-1.8,1.26-2.34,7.14-8.64,7.4-9.47,3.74-12.05,6.81-27.2,8.66-35.37.88-3.87,2.89-13.76,2.85-14.3-.41-6.29,2.1-10.37-9.66-17.89-12.87-8.24-29.77-15.18-39.98-20.36-1.5-.76-3.69-1.74-7.48-1.13-1.96.31-8.64,5.73-9.32,6.53Z';

const ART_STROKE = 'stroke-width="1" stroke-miterlimit="10" vector-effect="non-scaling-stroke"';

export const ICONS = {
  pointer: svg('<path d="M5 3l6.5 16 2.2-6.3L20 10.5z" fill="currentColor" stroke-width="1.4"/>'),

  // From the "pencil" layer of art/HyperMango-icons.svg; keeps its own colours.
  pencil: `<svg viewBox="30 339 232 232">${[
    `<polygon fill="#90c9d3" stroke="#cbcb2c" ${ART_STROKE} points="132.16 349.72 37.02 447.16 37.02 550.56 47.49 564.73 137.8 564.73 240.93 564.73 254.74 551.55 254.74 438.68 147.68 347.19 143.53 344.98 137.4 344.98 132.16 349.72"/>`,
    `<path fill="#ded9c1" d="M147.68,347.19l-4.15-2.21h-6.14l-5.23,4.74-95.14,97.44v2.14c4.33-.79,7.05-4.69,12.45-4.89,6.08-.23,6.63,4.57,14.35,5.24,1.62.14,2.78.03,12.72-2.69,15.04-4.12,15.65-4.78,18.68-4.45,7.37.8,8.04,5.16,14.35,4.87,6.02-.27,6.09-4.27,14.08-6.5,2.26-.63,12.25-3.1,19.76,1.89,3.74,2.49,3.72,4.74,6.5,5.14,5.22.76,6.77-7,13.8-8.06,3.72-.56,7.71,1.24,15.7,4.83,4.31,1.94,4.58,2.53,6.5,2.68,5.08.4,6.72-3.44,13.8-6.23,3.05-1.2,9.11-3.58,14.62-1.44,5.61,2.18,4.72,6.74,9.74,8.2,5.14,1.49,11.07-1.83,16.51-4.87,3.85-2.16,4.67-3.34,7.85-4.19,2.5-.67,4.46-.6,6.08-.38l-106.82-91.29Z"/>`,
    `<path fill="#231f20" d="M124.47,381.73c10.3,1.62,21.86.77,32.25.79,6.88.01,15.86-3.23,22.56-8.33l-31.59-27-4.15-2.21h-6.14l-5.23,4.74-24.43,25.02c.38.78.83,1.47,1.29,1.99,3.4,3.73,10.89,4.29,15.44,5.01Z"/>`,
    `<path fill="#231f20" d="M121.11,378.46c-1.89.52-3.23,1.45-5.14,1.62-2.37.22-4.71-.7-7.1-.54s-4.8.89-7.16-.04c3.24-4.66,8.15-6.81,13.18-9.16"/>`,
  ].join('')}</svg>`,

  // From the "Eraser" layer of art/HyperMango-icons.svg; keeps its own colours.
  eraser: `<svg viewBox="580 27 220 220">${[
    `<path fill="#d18c8c" stroke="#231f20" ${ART_STROKE} d="${ERASER_BODY}"/>`,
    `<path fill="#d1b4b4" stroke="#955051" ${ART_STROKE} d="M774.25,54.29c-12.87-8.24-29.77-15.18-39.98-20.36-1.5-.76-3.69-1.74-7.48-1.13-1.96.31-8.64,5.73-9.32,6.53-5.73,6.71-36.23,37.01-63.52,63.89h.75l64.96,31.94,1.62,2.44,1.08,5.95-5.73,43c22.4-25.69,44.2-51.59,46.73-53.42.16-.11,1.03-.7,1.62-1.8,1.26-2.34,7.14-8.64,7.4-9.47,3.74-12.05,6.81-27.2,8.66-35.37.88-3.87,2.89-13.76,2.85-14.3-.41-6.29,2.1-10.37-9.66-17.89Z"/>`,
    `<path fill="none" stroke="#88163c" ${ART_STROKE} d="${ERASER_BODY}"/>`,
  ].join('')}</svg>`,

  rect: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>'),

  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),

  fillRect: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="currentColor" stroke="none"/>'),

  fillEllipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="currentColor" stroke="none"/>'),

  // From the "bucket" layer of art/HyperMango-icons.svg. The handle's thick
  // stroke is part of its shape, so unlike the outlines it scales.
  bucket: `<svg viewBox="455 260 340 340">${[
    `<polygon fill="#ded9c1" stroke="#231f20" stroke-width=".75" stroke-miterlimit="10" vector-effect="non-scaling-stroke" points="783.92 445.17 643.23 585.86 494.71 437.33 635.4 298.65 783.92 445.17"/>`,
    `<polyline fill="#90c9d3" points="503.77 445.78 494.71 437.33 510.84 452.85 502.99 445.62 645.91 309.89 662.69 326.67 520.31 456.5 517.88 459.89"/>`,
    `<circle fill="#dedbcf" stroke="#231f20" ${ART_STROKE} cx="639.32" cy="388.74" r="19.9"/>`,
    `<path fill="none" stroke="#231f20" stroke-width="17" stroke-miterlimit="10" d="M639.54,395.98l-3.8-90.77-.97-7.03s-1.86-13.89-26.21-13.22c-25.98.72-27.43,33.65-27.43,33.65v5.14l-.3,8.39"/>`,
    `<polygon fill="#231f20" points="572.46 331.99 572.46 358.7 589.06 342.99 589.06 329.65 572.46 331.99"/>`,
    `<path fill="#941f61" d="M539.44,391.9c-6.15,0-12.22-1.04-18.24-1.1-4.22-.04-8.53.8-12.74,1.02-4.44.23-7.9-.16-11.69,1.88-2.06,1.11-3.84,2.66-6.06,3.61s-4.8,1.08-6.91,2.33c-4.43,2.63-7.55,5.96-9.04,10.76-1.78,5.72-6.02,11.13-7.21,16.87-.86,4.12-1,8.29-1,12.57,0,9.64.51,19.18.08,28.78-.51,11.47,3.65,23.12,6.4,34.08,1.59,6.36,1.48,14.65,1.46,21.65-.01,6.12-4.5,17.93,4.38,19.52,7.52,1.35,14.47-.05,16.91-8.02,3.01-9.84-1.04-19.45.57-29.48.66-4.09-.26-11.52,1.67-15.54,2.37,1.54,3.58,3.48,2.8,6.19.57-2.63,2.83-3.66,3.27-6.61.54-3.59-1.32-6.39-2.11-9.72-1.99-8.4-.48-17.44-1.12-26-.31-4.25.03-9.3-1.2-13.35-1.12-3.66-4.41-5.67-4.66-9.64.95.67,1.54,1.44,2.02,2.45-.26-.07-.52-.05-.77.05,1.62.51,3.26-.12,4.95-.44"/>`,
    `<polyline fill="#ded9c1" stroke="#231f20" ${ART_STROKE} points="543.3 388.74 494.71 437.33 500.72 443.34"/>`,
    `<path fill="#941f61" d="M496.72,427.58c-2.22.29-3.71,2.01-5.69,2.94-1.3.61-5.65.81-4.08,3.79.72,1.37,3.79.84,5.3.85,5.64.02,9.91-2.84,8.53-8.66"/>`,
  ].join('')}</svg>`,

  // From the "filled-shape-pencil" layer of art/HyperMango-icons.svg.
  lasso: `<svg viewBox="262.5 11 240 240"><path fill="#e8d1e0" stroke="#231f20" stroke-width=".75" stroke-miterlimit="10" vector-effect="non-scaling-stroke" d="M302.44,73.04c4.37-10.67,16.98-15.35,28.46-16.46s23.43.11,34.22-3.95c16.56-6.22,28.01-23.98,45.56-26.14,17.71-2.17,34.52,16.72,30.3,34.06,6.17-.29,12.29,3.79,14.38,9.6,15.15-1.51,30.78,7.51,37.05,21.38s2.73,31.56-8.4,41.94c-10.27,9.57-26.67,14.27-30.52,27.77-3.94,13.8,8.24,27.14,8.84,41.47.79,18.76-19.38,32.96-38.16,32.86s-35.87-10.21-51.79-20.17c-22.99-14.4-39.97-20.41-66.82-20.66-15.75-.15-29.8-7.19-34.72-23.3-5.81-19.01,6.64-28.69,18.93-40.44,7.55-7.22,12.78-13.91,13.49-24.6s-5.33-22.36-.82-33.36Z"/></svg>`,

  // From the "polygon" layer of art/HyperMango-icons.svg. A lower miter limit
  // than the art's 10 keeps the sharpest tips from spiking out of a 24px icon.
  polygon: `<svg viewBox="-19.5 142.6 240 240"><polygon fill="#cde5ba" stroke="#231f20" stroke-width=".75" stroke-miterlimit="3" vector-effect="non-scaling-stroke" points="56.2 190.62 63.78 246.23 6.4 315.13 88.68 303.22 59.45 363.86 137.41 295.53 194.79 315.13 194.79 161.39 131.99 226.74 56.2 190.62"/></svg>`,

  text: svg('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>'),

  button: svg('<rect x="3" y="8" width="18" height="8.5" rx="4.25"/><path d="M9 12.25h6"/>'),

  hand: svg(
    '<path d="M9 11.5V5.2a1.35 1.35 0 0 1 2.7 0v5.6"/>' +
    '<path d="M11.7 10.6V4.4a1.35 1.35 0 0 1 2.7 0v6.2"/>' +
    '<path d="M14.4 11V6.2a1.35 1.35 0 0 1 2.7 0v6.1"/>' +
    '<path d="M9 11.5V9.1a1.35 1.35 0 0 0-2.7 0v4.6"/>' +
    '<path d="M6.3 13.7c0 3.4 2.4 6.3 5.8 6.3 3 0 5-2.1 5-5.2v-2.5"/>'
  ),

  zoom: svg(
    '<circle cx="10.5" cy="10.5" r="6.2"/>' +
    '<path d="M15.2 15.2L20.5 20.5"/>' +
    '<path d="M8 10.5h5M10.5 8v5"/>'
  ),
};

/* Order mirrors the convention in illustration apps: selection and navigation
   at the top, then the drawing tools, then object placement. `sep` inserts a
   divider rather than a button. */
export const TOOL_META = [
  ['pointer', 'Pointer', 'V'],
  ['hand', 'Hand — drag to move the card', 'H'],
  ['zoom', 'Zoom — click in, ⌥click out', 'Z'],
  ['sep'],
  ['pencil', 'Pencil', 'P'],
  ['eraser', 'Eraser', 'E'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'C'],
  ['fillRect', 'Filled Rectangle', 'F'],
  ['fillEllipse', 'Filled Ellipse', 'O'],
  ['bucket', 'Paint Bucket', 'B'],
  ['lasso', 'Filled Shape Pencil', 'L'],
  ['polygon', 'Polygon', 'G'],
  ['sep'],
  ['text', 'Text', 'T'],
  ['button', 'Add Button', 'U'],
];

/* Where each tool acts, in 24px cursor space. The drawing tools act where the
   icon "touches" the page (pencil tip, eraser end, the bucket's drip); shape
   tools start from the shape's first corner. Tools absent here — Button, which
   acts immediately — keep the fallback cursor. */
const CURSOR_SPOTS = {
  pointer: [5, 3],
  hand: [12, 12],
  zoom: [10, 10],
  pencil: [11, 1],
  eraser: [5, 21],
  rect: [4, 6],
  ellipse: [4, 6],
  fillRect: [4, 6],
  fillEllipse: [4, 6],
  bucket: [2, 23],
  lasso: [12, 12],
  polygon: [3, 17],
  text: [12, 12],
};

// id → [1x PNG, 2x PNG], filled in by prepareCursors().
const cursorImages = new Map();

/** Rasterise every tool icon to PNG cursors. WebKit (the macOS web view) will
    not reliably use SVG images as cursors, so PNGs are the portable choice. */
export function prepareCursors() {
  return Promise.all(Object.keys(CURSOR_SPOTS).map(async (id) => {
    try {
      const img = await loadSvg(ICONS[id]);
      cursorImages.set(id, [rasterise(img, 24), rasterise(img, 48)]);
    } catch { /* keep the fallback cursor for this tool */ }
  }));
}

function loadSvg(icon) {
  const svg = icon.replace('<svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" color="#1d1d1f"');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
}

/** Draw the icon at `px` square with a one-point white halo, so it stays
    visible over dark paint. */
function rasterise(img, px) {
  const canvas = (w) => Object.assign(document.createElement('canvas'), { width: w, height: w });
  const halo = canvas(px);
  const h = halo.getContext('2d');
  h.drawImage(img, 0, 0, px, px);
  h.globalCompositeOperation = 'source-in';
  h.fillStyle = '#fff';
  h.fillRect(0, 0, px, px);

  const out = canvas(px);
  const o = out.getContext('2d');
  const r = px / 24;
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
    o.drawImage(halo, dx * r, dy * r);
  }
  o.drawImage(img, 0, 0, px, px);
  return out.toDataURL('image/png');
}

/** Show tool `id`'s icon as the cursor on `el`, or `fallback` until the
    cursors are prepared (and for tools without one). */
export function applyToolCursor(el, id, fallback = 'default') {
  const images = cursorImages.get(id);
  el.style.cursor = fallback;
  if (!images) return;
  const [x, y] = CURSOR_SPOTS[id];
  el.style.cursor = `url("${images[0]}") ${x} ${y}, ${fallback}`;
  // Sharper on Retina where supported; an unsupported value is simply ignored.
  el.style.cursor = `-webkit-image-set(url("${images[0]}") 1x, url("${images[1]}") 2x) ${x} ${y}, ${fallback}`;
  el.style.cursor = `image-set(url("${images[0]}") 1x, url("${images[1]}") 2x) ${x} ${y}, ${fallback}`;
}
