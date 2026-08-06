/**
 * The nine voices.
 *
 * ==========================================================================
 * PORTED, NOT REINVENTED
 * ==========================================================================
 * Every oscillator, filter, frequency and envelope below is transcribed from
 * Volume One §4. The specification is executable — the artifact synthesises
 * these live — so this is a port of working code rather than an interpretation
 * of a description, and the two can be compared by ear.
 *
 * No samples and no files, deliberately: it proves the palette is producible
 * deterministically at any sample rate, and it means the specification cannot
 * drift from the asset because there is no asset.
 *
 * ==========================================================================
 * THE LAWS, AND WHY THEY ARE IN THE CODE
 * ==========================================================================
 *   OFF BY DEFAULT, remembered per operator. A gallery has its own audio
 *   discipline and an unexpected noise on a live desk is a fault, not a
 *   delight.
 *
 *   A sound may CONFIRM that something happened. A sound may never be the only
 *   way to know it happened, and may never be required to complete a task.
 *   Nothing here is called from a code path that has no visual equivalent.
 *
 *   DUCKING: all interface sound mutes while on air, except `alert`. An
 *   operator mid-transmission must not hear the editor; but the one voice that
 *   means "a person is needed" has to survive, or it is not an alert.
 *
 *   No voice exceeds 420 ms. −24 LUFS nominal, well under gallery talkback.
 *
 * The character is hardware: short, dry, mechanical, no melody, no
 * personality. Nothing is cute. Nothing is a marimba.
 */

export type VoiceName =
  | "tick"
  | "detent"
  | "press"
  | "cue"
  | "take"
  | "offair"
  | "notify"
  | "alert"
  | "install";

export interface VoiceDoc {
  readonly label: string;
  readonly when: string;
}

/** What each voice is FOR, in the operator's words. */
export const VOICES: Record<VoiceName, VoiceDoc> = {
  tick: { label: "Detent", when: "hover · scrub tick" },
  detent: { label: "Set", when: "snap · toggle · dock" },
  press: { label: "Key", when: "button travel" },
  cue: { label: "Cue", when: "armed for preview" },
  take: { label: "Take", when: "cut to program" },
  offair: { label: "Off air", when: "broadcast ended" },
  notify: { label: "Report", when: "background result" },
  alert: { label: "Attention", when: "needs a person" },
  install: { label: "Acquire", when: "package installed" },
};

export const VOICE_NAMES = Object.keys(VOICES) as readonly VoiceName[];

/** The one voice that survives ducking. */
export const ALERT: VoiceName = "alert";

/** Volume One §4: "No voice exceeds 420 ms." Asserted by a test. */
export const MAX_VOICE_MS = 420;

/**
 * The one voice the length law does not cover, and why.
 *
 * ==========================================================================
 * A CONTRADICTION IN THE SPECIFICATION, RECORDED RATHER THAN RESOLVED QUIETLY
 * ==========================================================================
 * Volume One §4 states "No voice exceeds 420 ms" and, in the same section,
 * synthesises `offair` at 780 ms — with the note "the only descending voice;
 * release is long". Both are the specification. They disagree.
 *
 * The artifact is executable and says so of itself: "If a specimen misbehaves
 * in this document, the specification is wrong — not the drawing of it." The
 * running sound is therefore the authority, and the 420 ms prose is the drift.
 *
 * So `offair` keeps its long release, is exempted HERE where the exemption is
 * visible, and the law still binds the other eight. Silently shortening the
 * voice would have changed the sound of going off air to satisfy a sentence;
 * silently raising the limit would have removed the law for everything.
 *
 * This needs a decision in Volume One. It is flagged, not buried.
 */
export const LENGTH_LAW_EXEMPT: readonly VoiceName[] = ["offair"];

/**
 * The longest a voice runs, in seconds.
 *
 * Declared beside the synthesis so the two cannot drift: a voice lengthened
 * without updating this would fail the length test rather than quietly
 * breaking a law nobody re-reads.
 */
export const VOICE_LENGTH: Record<VoiceName, number> = {
  tick: 0.014,
  detent: 0.022,
  press: 0.055,
  cue: 0.1,
  take: 0.34,
  offair: 0.78,
  notify: 0.2,
  alert: 0.17,
  install: 0.32,
};

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

type AudioContextCtor = new () => AudioContext;

export interface SoundOptions {
  /** Injected so tests can drive the scheduler without a browser. */
  readonly contextFactory?: () => AudioContext | null;
}

export class SoundEngine {
  #ctx: AudioContext | null = null;
  #bus: GainNode | null = null;
  #noise: AudioBuffer | null = null;
  #enabled = false;
  #onAir = false;
  readonly #factory: () => AudioContext | null;

  constructor(options: SoundOptions = {}) {
    this.#factory =
      options.contextFactory ??
      (() => {
        const Ctor = (globalThis as { AudioContext?: AudioContextCtor }).AudioContext;
        return Ctor === undefined ? null : new Ctor();
      });
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get onAir(): boolean {
    return this.#onAir;
  }

  /**
   * Ducking.
   *
   * Set from the programme bus, not guessed. While this is true every voice
   * but `alert` is silent.
   */
  setOnAir(onAir: boolean): void {
    this.#onAir = onAir;
  }

  toggle(value?: boolean): boolean {
    this.#enabled = value === undefined ? !this.#enabled : value;
    if (this.#enabled) this.#ensure();
    return this.#enabled;
  }

  /** True when this voice would actually be heard right now. */
  audible(name: VoiceName): boolean {
    if (!this.#enabled) return false;
    return !this.#onAir || name === ALERT;
  }

  play(name: VoiceName): void {
    if (!this.audible(name)) return;
    const ctx = this.#ensure();
    if (ctx === null) return;

    // `resume()` is asynchronous, and scheduling against a suspended clock is
    // silence — the sound is lost with no error, which is the hardest kind of
    // audio bug to notice.
    const go = (): void => this.#render(name, ctx.currentTime + 0.001);
    if (ctx.state === "running") {
      go();
      return;
    }
    const resumed = ctx.resume?.();
    if (resumed !== undefined && typeof resumed.then === "function") {
      resumed
        .then(() => {
          if (ctx.state === "running") go();
        })
        .catch(() => undefined);
    } else {
      go();
    }
  }

  dispose(): void {
    void this.#ctx?.close?.();
    this.#ctx = null;
    this.#bus = null;
    this.#noise = null;
  }

  #ensure(): AudioContext | null {
    if (this.#ctx !== null) return this.#ctx;
    const ctx = this.#factory();
    if (ctx === null) return null;
    this.#ctx = ctx;

    const bus = ctx.createGain();
    // −24 LUFS nominal. The bus is the only place level is set, so there is
    // one number to change rather than nine.
    bus.gain.value = 0.9;
    bus.connect(ctx.destination);
    this.#bus = bus;

    const samples = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = Math.random() * 2 - 1;
    this.#noise = buffer;

    return ctx;
  }

  #noiseBurst(
    t: number,
    duration: number,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    peak: number,
  ): void {
    const ctx = this.#ctx;
    const bus = this.#bus;
    const buffer = this.#noise;
    if (ctx === null || bus === null || buffer === null) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.0016);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  #tone(
    t: number,
    duration: number,
    type: OscillatorType,
    from: number,
    to: number,
    peak: number,
    attack = 0.004,
  ): void {
    const ctx = this.#ctx;
    const bus = this.#bus;
    if (ctx === null || bus === null) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration * 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Volume One §4, transcribed. The comments are the specification's own. */
  #render(name: VoiceName, t: number): void {
    switch (name) {
      // A detent. The smallest confirmation the product makes.
      case "tick":
        this.#noiseBurst(t, 0.014, "bandpass", 4200, 6, 0.05);
        return;

      // A control has moved to a definite position.
      case "detent":
        this.#noiseBurst(t, 0.022, "bandpass", 2100, 4, 0.09);
        this.#tone(t, 0.02, "sine", 880, 880, 0.03);
        return;

      // A key has travelled. Mechanical, damped, no ring.
      case "press":
        this.#noiseBurst(t, 0.026, "lowpass", 1500, 1, 0.12);
        this.#tone(t, 0.055, "sine", 148, 118, 0.11);
        return;

      // Cued. Rising, quiet, teal.
      case "cue":
        this.#tone(t, 0.1, "triangle", 587, 880, 0.045, 0.006);
        this.#noiseBurst(t, 0.012, "bandpass", 3400, 6, 0.028);
        return;

      // THE take. Relay contact, low mass, brief metal.
      case "take":
        this.#noiseBurst(t, 0.045, "bandpass", 850, 1.4, 0.24);
        this.#tone(t, 0.34, "sine", 58, 40, 0.5, 0.002);
        this.#tone(t + 0.004, 0.19, "sine", 1560, 1490, 0.035, 0.001);
        this.#tone(t + 0.004, 0.15, "sine", 2320, 2260, 0.02, 0.001);
        return;

      // Off air. The only descending voice; release is long.
      case "offair":
        this.#tone(t, 0.78, "sine", 196, 92, 0.075, 0.02);
        this.#noiseBurst(t, 0.05, "lowpass", 700, 1, 0.06);
        return;

      // Something needs a person. Two low knocks — never a chime.
      case "alert":
        this.#tone(t, 0.07, "square", 172, 172, 0.035);
        this.#tone(t + 0.1, 0.07, "square", 172, 172, 0.035);
        return;

      // Reported, not demanded.
      case "notify":
        this.#tone(t, 0.2, "sine", 1046, 1046, 0.03, 0.008);
        return;

      // Acquired. Three rising ticks resolving to a detent and a small weight.
      case "install":
        [1180, 1560, 2050].forEach((frequency, index) => {
          this.#tone(t + index * 0.055, 0.045, "sine", frequency, frequency, 0.03, 0.003);
        });
        this.#noiseBurst(t + 0.19, 0.03, "bandpass", 2100, 4, 0.1);
        this.#tone(t + 0.19, 0.13, "sine", 96, 76, 0.13, 0.002);
        return;
    }
  }
}
