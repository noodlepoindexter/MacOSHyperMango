/* ---------------------------------------------------------------------------
   The document model.

   Plain data plus pure-ish helpers. Card paint layers live here as PNG data
   URLs, matching the web version's in-memory shape — the Rust side converts to
   and from real files at the package boundary, so nothing in the frontend has
   to know which format backs the document.
   --------------------------------------------------------------------------- */

/** Card dimensions. Fixed, and deliberately identical to the web version so
    stacks round-trip pixel-for-pixel. */
export const CARD_W = 1063;
export const CARD_H = 797;

let buttonCounter = 1;
let textCounter = 1;
let cardCounter = 0;

/** Cards are named card_a, card_b, … card_z, card_aa, … */
export function defaultCardName(index) {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(97 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `card_${name}`;
}

export function createCard(name) {
  cardCounter++;
  return {
    id: `card_${Date.now()}_${cardCounter}`,
    name: name || defaultCardName(cardCounter - 1),
    imageData: null,
    textObjects: [],
    buttons: [],
    script: '',
  };
}

export function createStack() {
  return {
    projectName: 'Untitled Stack',
    variables: {},
    customSounds: {},
    cards: [createCard()],
  };
}

/** Size and label of a freshly added button. */
export const NEW_BUTTON = { w: 140, h: 44, label: 'Button' };

export function createButton(cardIndex, existingCount) {
  // Cascade new buttons so several added in a row do not stack exactly.
  const offset = existingCount * 24;
  const id = `btn_${buttonCounter}`;
  const nameId = `button_${buttonCounter}`;
  buttonCounter++;
  return {
    id,
    nameId,
    label: NEW_BUTTON.label,
    x: Math.min(50 + offset, CARD_W - 150),
    y: Math.min(50 + offset, CARD_H - 54),
    w: NEW_BUTTON.w,
    h: NEW_BUTTON.h,
    goto: 0,
    sound: '',
    invisible: false,
    isCanvas: false,
    canvasData: null,
    effect: '',
    script: '',
  };
}

export function createText(x, y, style = {}) {
  const id = `text_${textCounter++}`;
  return {
    id,
    x,
    y,
    w: 200,
    h: 40,
    content: '',
    fontFamily: style.fontFamily || 'system-ui, sans-serif',
    fontSize: style.fontSize || 20,
    color: style.color || '#000000',
  };
}

/**
 * Advance the id counters past anything already present, so ids generated
 * after loading a document cannot collide with loaded ones.
 */
export function reseedCounters(cards) {
  let maxBtn = 0;
  let maxText = 0;
  for (const card of cards) {
    for (const b of card.buttons || []) {
      const n = parseInt(String(b.id || '').replace(/\D+/g, ''), 10);
      if (Number.isFinite(n)) maxBtn = Math.max(maxBtn, n);
    }
    for (const t of card.textObjects || []) {
      const n = parseInt(String(t.id || '').replace(/\D+/g, ''), 10);
      if (Number.isFinite(n)) maxText = Math.max(maxText, n);
    }
  }
  buttonCounter = maxBtn + 1;
  textCounter = maxText + 1;
  cardCounter = cards.length;
}

/**
 * Normalise a document loaded from disk. The web version allowed most fields
 * to be absent; filling them in here means nothing downstream null-checks.
 */
export function fromDocument(doc) {
  const cards = (doc.stack || []).map((c) => ({
    id: c.id ?? `card_${Math.random().toString(36).slice(2)}`,
    name: c.name || 'Card',
    script: c.script || '',
    imageData: c.imageData || null,
    textObjects: (c.textObjects || []).map((t) => ({
      id: t.id,
      x: t.x ?? 0,
      y: t.y ?? 0,
      w: t.w ?? 200,
      h: t.h ?? 40,
      content: t.content ?? '',
      fontFamily: t.fontFamily || 'system-ui, sans-serif',
      fontSize: t.fontSize ?? 20,
      color: t.color || '#000000',
    })),
    buttons: (c.buttons || []).map((b) => ({
      id: b.id,
      nameId: b.nameId || b.id,
      label: b.label ?? 'Button',
      x: b.x ?? 0,
      y: b.y ?? 0,
      w: b.w ?? 100,
      h: b.h ?? 32,
      goto: b.goto ?? 0,
      sound: b.sound || '',
      invisible: !!b.invisible,
      isCanvas: !!b.isCanvas,
      canvasData: b.canvasData || null,
      effect: b.effect || '',
      script: b.script || '',
    })),
  }));

  if (cards.length === 0) cards.push(createCard());
  reseedCounters(cards);

  return {
    projectName: doc.projectName || 'Untitled Stack',
    variables: doc.variables && typeof doc.variables === 'object' ? doc.variables : {},
    customSounds: doc.customSounds && typeof doc.customSounds === 'object' ? doc.customSounds : {},
    cards,
  };
}

/** Shape the model back into the payload the Rust commands expect. */
export function toDocument(stack) {
  return {
    projectName: stack.projectName,
    variables: stack.variables,
    customSounds: stack.customSounds,
    stack: stack.cards.map((c) => ({
      id: c.id,
      name: c.name,
      script: c.script,
      imageData: c.imageData,
      textObjects: c.textObjects,
      buttons: c.buttons,
    })),
  };
}

/** Find a card index by name, then by 1-based number. Mirrors `go card`. */
export function findCardIndex(cards, target) {
  if (target.kind === 'number') {
    const i = target.value - 1;
    return i >= 0 && i < cards.length ? i : -1;
  }
  const byName = cards.findIndex((c) => c.name === target.value);
  if (byName >= 0) return byName;
  const n = parseInt(target.value, 10);
  return Number.isFinite(n) && n >= 1 && n <= cards.length ? n - 1 : -1;
}

/** Ensure a card name is unique within the stack, suffixing if needed. */
export function uniqueCardName(cards, name, exceptIndex = -1) {
  const taken = new Set(cards.filter((_, i) => i !== exceptIndex).map((c) => c.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}
