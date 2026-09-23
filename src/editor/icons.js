/* Inline SVG icons. Stroke-based and currentColor-driven so they invert
   correctly on selected toolbar buttons and in dark mode. */

const svg = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" ${opts}>${body}</svg>`;

export const ICONS = {
  pointer: svg('<path d="M5 3l6.5 16 2.2-6.3L20 10.5z" fill="currentColor" stroke-width="1.4"/>'),

  pencil: svg('<path d="M4 20l4-1 9.5-9.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M14.5 5.5l3 3"/>'),

  eraser: svg(
    '<path d="M8 20h11"/>' +
    '<path d="M15.5 4.5l4 4a1.6 1.6 0 0 1 0 2.3L11 19.3a1.6 1.6 0 0 1-2.3 0l-4-4a1.6 1.6 0 0 1 0-2.3l8.5-8.5a1.6 1.6 0 0 1 2.3 0z"/>' +
    '<path d="M9 8.5l6.5 6.5"/>'
  ),

  rect: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>'),

  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),

  fillRect: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="currentColor" stroke="none"/>'),

  bucket: svg(
    '<path d="M6 8.5l6-5.5 7 7-6 5.5a2 2 0 0 1-2.8 0L6 11.3a2 2 0 0 1 0-2.8z"/>' +
    '<path d="M9.5 5.5L8 4"/>' +
    '<path d="M20 15.5c0 1.4-.9 2.5-2 2.5s-2-1.1-2-2.5 2-3.5 2-3.5 2 2.1 2 3.5z" fill="currentColor" stroke="none"/>'
  ),

  lasso: svg(
    '<path d="M12 4.5c4.7 0 8.5 2.5 8.5 5.6 0 3-3.8 5.5-8.5 5.5-1.4 0-2.8-.2-4-.6"/>' +
    '<path d="M8 15c-2.7-1-4.5-2.8-4.5-4.9C3.5 7 7.3 4.5 12 4.5"/>' +
    '<path d="M7.5 15.2c0 1.6.6 2.6.6 3.6a1.6 1.6 0 1 1-3.2 0c0-1 .8-1.7.8-2.6"/>'
  ),

  polygon: svg('<path d="M12 3.5l8 6-3 9.5H7l-3-9.5z"/>'),

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
  ['bucket', 'Paint Bucket', 'B'],
  ['lasso', 'Filled Shape Pencil', 'L'],
  ['polygon', 'Polygon', 'G'],
  ['sep'],
  ['text', 'Text', 'T'],
  ['button', 'Add Button', 'U'],
];
