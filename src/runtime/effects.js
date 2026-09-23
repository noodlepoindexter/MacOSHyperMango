/* ---------------------------------------------------------------------------
   Card effects. Each applies a CSS animation class to the card container and
   removes it when the animation ends, so effects can be retriggered.
   Keyframes live in styles/effects.css and are inlined into HTML exports.
   --------------------------------------------------------------------------- */

export const EFFECTS = ['shake', 'flash', 'wobble', 'negative'];

const CLASS = {
  shake: 'fx-shake',
  flash: 'fx-flash',
  wobble: 'fx-wobble',
  negative: 'fx-negative',
};

/**
 * Play a named effect on an element.
 * @returns {Promise<void>} resolves when the animation finishes
 */
export function triggerEffect(el, name) {
  const cls = CLASS[name];
  if (!el || !cls) return Promise.resolve();

  // Removing and reflowing restarts the animation if it is already running.
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);

  return new Promise((resolve) => {
    const done = () => {
      el.classList.remove(cls);
      resolve();
    };
    el.addEventListener('animationend', done, { once: true });
    // Fallback in case the animation never fires (element hidden, etc).
    setTimeout(done, 1200);
  });
}
