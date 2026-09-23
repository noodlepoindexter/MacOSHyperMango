/* Swatch rail: two columns of colours down the left edge, paged by arrows. */

const PER_SET = 32;

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}

const hues = Array.from({ length: 16 }, (_, i) => i * (360 / 16));

export const COLOR_SETS = [
  {
    name: 'Primaries',
    colors: [
      ...hues.map((h) => hslToHex(h, 100, 50)),
      ...hues.map((h) => hslToHex(h, 100, 28)),
    ],
  },
  {
    name: 'Grays',
    colors: Array.from({ length: PER_SET }, (_, i) => {
      const v = Math.round((i / (PER_SET - 1)) * 255).toString(16).padStart(2, '0');
      return `#${v}${v}${v}`;
    }),
  },
  {
    name: 'Pastels',
    colors: [
      ...hues.map((h) => hslToHex(h, 90, 85)),
      ...hues.map((h) => hslToHex(h, 70, 75)),
    ],
  },
];

export class SwatchRail {
  /**
   * @param {HTMLElement} root  container holding #palette-swatches and the arrows
   * @param {(colour: string, button: 'left'|'right') => void} onPick
   */
  constructor(root, onPick) {
    this.grid = root.querySelector('#palette-swatches');
    this.label = root.querySelector('#palette-set-name');
    this.onPick = onPick;
    this.setIndex = 0;

    root.querySelector('#palette-prev').addEventListener('click', () => this.page(-1));
    root.querySelector('#palette-next').addEventListener('click', () => this.page(1));

    this.grid.addEventListener('click', (e) => {
      const c = e.target.closest('.rail-swatch')?.dataset.color;
      if (c) this.onPick(c, 'left');
    });
    this.grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const c = e.target.closest('.rail-swatch')?.dataset.color;
      if (c) this.onPick(c, 'right');
    });

    this.render();
  }

  page(delta) {
    const n = COLOR_SETS.length;
    this.setIndex = (this.setIndex + delta + n) % n;
    this.render();
  }

  render() {
    const set = COLOR_SETS[this.setIndex];
    this.label.textContent = set.name;
    this.grid.innerHTML = '';
    for (const c of set.colors) {
      const sw = document.createElement('button');
      sw.className = 'rail-swatch';
      sw.style.background = c;
      sw.dataset.color = c;
      sw.title = `${c} — click: line, right-click: fill`;
      this.grid.appendChild(sw);
    }
    this.highlight(this.stroke, this.fill);
  }

  /** Mark the swatches matching the current stroke and fill colours. */
  highlight(stroke, fill) {
    this.stroke = stroke;
    this.fill = fill;
    for (const sw of this.grid.children) {
      sw.classList.toggle('is-stroke', sw.dataset.color === stroke);
      sw.classList.toggle('is-fill', sw.dataset.color === fill);
    }
  }
}
