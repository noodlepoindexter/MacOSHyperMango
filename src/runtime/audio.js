/* ---------------------------------------------------------------------------
   Sound.

   Two sources, resolved in this order so a stack can shadow a built-in name:
     1. custom sounds imported into the document (data URLs)
     2. the six synthesised effects, generated with the Web Audio API
     3. bundled sample files shipped with the app

   Every play returns a promise that settles when the sound finishes, which is
   what `wait until done` blocks on.
   --------------------------------------------------------------------------- */

/** Names generated procedurally — these always work, with no assets present. */
export const SYNTH_SOUNDS = ['click', 'beep', 'chime', 'whoosh', 'drum', 'glass'];

/** Sample files bundled with the app, carried over from the web version. */
export const BUNDLED_SOUNDS = [
  'beam_me_up_scotty', 'bubbling_potion', 'chicken', 'creaky_door_short',
  'demon_your_soul', 'door_creak', 'explosion', 'kid_laugh',
  'magical_disappearance', 'magical_energy_burst', 'monster_1',
];

const SYNTH_SET = new Set(SYNTH_SOUNDS);

export class AudioEngine {
  /**
   * @param {object} customSounds  { name: { dataUrl } } from the document
   * @param {string} assetBase     URL prefix for bundled samples
   */
  constructor(customSounds = {}, assetBase = '/audio/') {
    this.customSounds = customSounds;
    this.assetBase = assetBase;
    this.ctx = null;
    this.pending = new Set();
    this.elements = new Set();
  }

  setCustomSounds(map) {
    this.customSounds = map || {};
  }

  context() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Resolves when every sound started so far has finished. */
  waitForAll() {
    return Promise.all([...this.pending]).then(() => {});
  }

  /** Silence everything — used when leaving play mode. */
  stopAll() {
    for (const el of this.elements) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        /* element already discarded */
      }
    }
    this.elements.clear();
    this.pending.clear();
  }

  /**
   * Play a sound by name.
   * @returns {Promise<void>} settles when playback ends
   */
  play(name) {
    const p = this._play(name);
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
    return p;
  }

  _play(name) {
    if (!name) return Promise.resolve();

    const custom = this.customSounds[name];
    if (custom && custom.dataUrl) return this.playUrl(custom.dataUrl);

    if (SYNTH_SET.has(name)) return this.playSynth(name);

    return this.playUrl(`${this.assetBase}${name}.mp3`);
  }

  /** Play an audio file. Failures resolve rather than reject so a missing
      sound never wedges a script waiting on `wait until done`. */
  playUrl(url) {
    return new Promise((resolve) => {
      let audio;
      try {
        audio = new Audio(url);
      } catch {
        resolve();
        return;
      }
      const done = () => {
        this.elements.delete(audio);
        resolve();
      };
      this.elements.add(audio);
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      audio.play().catch(done);
    });
  }

  /* The six synthesised sounds. Envelopes and frequencies are carried over
     from the web version so existing stacks sound the same. */
  playSynth(name) {
    return new Promise((resolve) => {
      let ctx;
      try {
        ctx = this.context();
      } catch {
        resolve();
        return;
      }
      const now = ctx.currentTime;
      const out = ctx.destination;

      const osc = (type, freq) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        o.connect(g);
        g.connect(out);
        return [o, g];
      };

      const noiseBuffer = (seconds) => {
        const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return buf;
      };

      switch (name) {
        case 'click': {
          const [o, g] = osc('sine', 1200);
          o.frequency.exponentialRampToValueAtTime(400, now + 0.08);
          g.gain.setValueAtTime(0.3, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          o.start(now);
          o.stop(now + 0.1);
          o.onended = resolve;
          break;
        }
        case 'beep': {
          const [o, g] = osc('square', 880);
          g.gain.setValueAtTime(0.2, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          o.start(now);
          o.stop(now + 0.2);
          o.onended = resolve;
          break;
        }
        case 'chime': {
          // A rising four-note arpeggio; resolve once the last note ends.
          let remaining = 4;
          const oneDone = () => {
            if (--remaining === 0) resolve();
          };
          [523, 659, 784, 1047].forEach((freq, i) => {
            const t = now + i * 0.15;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            o.connect(g);
            g.connect(out);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.25, t + 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            o.start(t);
            o.stop(t + 0.7);
            o.onended = oneDone;
          });
          break;
        }
        case 'whoosh': {
          const src = ctx.createBufferSource();
          const filter = ctx.createBiquadFilter();
          const g = ctx.createGain();
          src.buffer = noiseBuffer(0.3);
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(4000, now);
          filter.frequency.exponentialRampToValueAtTime(200, now + 0.3);
          g.gain.setValueAtTime(0.4, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
          src.connect(filter);
          filter.connect(g);
          g.connect(out);
          src.start(now);
          src.stop(now + 0.35);
          src.onended = resolve;
          break;
        }
        case 'drum': {
          // Noise burst plus a pitched-down thump, both must finish.
          let remaining = 2;
          const oneDone = () => {
            if (--remaining === 0) resolve();
          };
          const src = ctx.createBufferSource();
          const gN = ctx.createGain();
          src.buffer = noiseBuffer(0.2);
          gN.gain.setValueAtTime(0.8, now);
          gN.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          src.connect(gN);
          gN.connect(out);

          const [o, gO] = osc('sine', 150);
          o.frequency.exponentialRampToValueAtTime(50, now + 0.1);
          gO.gain.setValueAtTime(0.8, now);
          gO.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

          src.start(now);
          src.stop(now + 0.2);
          o.start(now);
          o.stop(now + 0.15);
          src.onended = oneDone;
          o.onended = oneDone;
          break;
        }
        case 'glass': {
          const [o, g] = osc('sine', 2000);
          g.gain.setValueAtTime(0.3, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
          o.start(now);
          o.stop(now + 1.3);
          o.onended = resolve;
          break;
        }
        default:
          resolve();
      }
    });
  }
}
