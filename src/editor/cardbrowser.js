/* Card thumbnail sidebar. Thumbnails are drawn from each card's paint layer
   plus rough boxes for its objects, so the strip conveys layout at a glance
   without re-rendering the full object DOM per card. */

import { CARD_W, CARD_H } from '../model/stack.js';

/* Two-thirds of the original 160px sidebar thumbnail, matching --thumb-w. */
const THUMB_W = 107;
const THUMB_H = Math.round((THUMB_W * CARD_H) / CARD_W);

export class CardBrowser {
  constructor(listEl, app) {
    this.list = listEl;
    this.app = app;
    this.thumbs = new Map(); // card id -> canvas
  }

  render() {
    const cards = this.app.stack().cards;
    const current = this.app.currentIndex();
    this.list.innerHTML = '';
    this.thumbs.clear();

    cards.forEach((card, i) => {
      const item = document.createElement('div');
      item.className = `card-thumb${i === current ? ' active' : ''}`;

      const cnv = document.createElement('canvas');
      cnv.width = THUMB_W;
      cnv.height = THUMB_H;
      item.appendChild(cnv);
      this.thumbs.set(card.id, cnv);

      const label = document.createElement('div');
      label.className = 'card-thumb-label';
      const name = document.createElement('b');
      name.textContent = card.name;
      const num = document.createElement('span');
      num.textContent = String(i + 1);
      label.append(name, num);
      item.appendChild(label);

      item.addEventListener('click', () => this.app.goToCard(i));
      this.list.appendChild(item);

      this.paint(card);
    });

    // Keep the active card in view when navigating by keyboard or script.
    // Horizontal strip, so track the inline axis as well as the block one.
    this.list.children[current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Redraw one thumbnail. */
  paint(card) {
    const cnv = this.thumbs.get(card.id);
    if (!cnv) return;
    const ctx = cnv.getContext('2d');
    const sx = THUMB_W / CARD_W;
    const sy = THUMB_H / CARD_H;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);

    const drawObjects = () => {
      ctx.save();
      ctx.scale(sx, sy);
      for (const t of card.textObjects) {
        if (!t.content) continue;
        ctx.fillStyle = t.color;
        // Text is too small to read at thumbnail scale; a bar reads better.
        ctx.fillRect(t.x, t.y + t.fontSize * 0.2, Math.min(t.w, t.content.length * t.fontSize * 0.5), t.fontSize * 0.7);
      }
      for (const b of card.buttons) {
        ctx.strokeStyle = b.invisible ? '#e8792b' : '#8b93a1';
        ctx.lineWidth = 2;
        if (b.invisible) ctx.setLineDash([4, 4]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
      }
      ctx.restore();
    };

    if (card.imageData) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, THUMB_W, THUMB_H);
        drawObjects();
      };
      img.onerror = drawObjects;
      img.src = card.imageData;
    } else {
      drawObjects();
    }
  }

  /** Update the active highlight without rebuilding the list. */
  setActive(index) {
    [...this.list.children].forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });
    this.list.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
