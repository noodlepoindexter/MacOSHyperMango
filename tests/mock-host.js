/* A host implementation that records effects instead of performing them, so
   interpreter behaviour can be asserted without a DOM. */

export class MockHost {
  constructor(opts = {}) {
    this.log = [];
    this.errors = [];
    this.texts = new Map(Object.entries(opts.texts || {}));
    this.buttons = new Map(Object.entries(opts.buttons || {})); // id -> visible
    this.cardName = opts.cardName ?? 'card_a';
    this.cardNumber = opts.cardNumber ?? 1;
    this.answers = opts.answers ? [...opts.answers] : []; // queued ask/yesno replies
  }

  goCard(target) {
    this.log.push(`go:${target.kind}${target.value !== undefined ? ':' + target.value : ''}`);
  }
  playSound(name) {
    this.log.push(`sound:${name}`);
  }
  waitForSounds() {
    this.log.push('waitSounds');
  }
  showButton(id) {
    this.buttons.set(id, true);
    this.log.push(`show:${id}`);
  }
  hideButton(id) {
    this.buttons.set(id, false);
    this.log.push(`hide:${id}`);
  }
  isButtonVisible(id) {
    return this.buttons.get(id) ?? false;
  }
  moveButton(id, dir, amount, isPercent, seconds) {
    this.log.push(`move:${id}:${dir}:${amount}${isPercent ? '%' : ''}:${seconds}`);
  }
  triggerEffect(name) {
    this.log.push(`fx:${name}`);
  }
  ask(prompt) {
    this.log.push(`ask:${prompt}`);
    return this.answers.shift() ?? '';
  }
  say(prompt) {
    this.log.push(`say:${prompt}`);
  }
  yesno(prompt) {
    this.log.push(`yesno:${prompt}`);
    return this.answers.shift() ?? 0;
  }
  speak(text) {
    this.log.push(`speak:${text}`);
  }
  setVoice(name, rate) {
    this.log.push(`voice:${name ?? '_'}:${rate ?? '_'}`);
  }
  getText(name) {
    return this.texts.has(name) ? this.texts.get(name) : null;
  }
  setText(name, value) {
    if (!this.texts.has(name)) return false;
    this.texts.set(name, value);
    this.log.push(`text:${name}=${value}`);
    return true;
  }
  currentCardName() {
    return this.cardName;
  }
  currentCardNumber() {
    return this.cardNumber;
  }
  reportError(message, line) {
    this.errors.push({ message, line });
  }
}
