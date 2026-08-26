/**
 * The sound system — a theme-like registry, zero bundled assets.
 *
 * Every key in SOUNDS maps to a player function; the defaults synthesize
 * small WebAudio blips so the game is audible out of the box. To replace a
 * sound with your own, drop an audio file into `public/pack/sounds/` named
 * after the key (`summon.mp3`, `victory.mp3`, …) — files are detected at
 * startup and win over the synth automatically, no code changes. To add a
 * new sound, add a key here and call playSound('yourKey') wherever it fits.
 *
 * Mute state persists per browser (the 🔊 button on the menu's top bar).
 */

type SynthStep = {
  /** Start/end frequency in Hz (endFreq defaults to freq). */
  freq: number;
  endFreq?: number;
  /** Seconds. */
  duration: number;
  type?: OscillatorType;
  volume?: number;
  /** Seconds to wait before this step starts. */
  delay?: number;
};

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('tm-muted') === '1';
} catch {
  // storage unavailable — start unmuted
}

/** Files found in public/pack/sounds/, keyed by sound name. */
const fileOverrides = new Map<string, string>();

function audioCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function synth(steps: SynthStep[]): void {
  const ac = audioCtx();
  if (!ac) return;
  for (const s of steps) {
    const start = ac.currentTime + (s.delay ?? 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = s.type ?? 'triangle';
    osc.frequency.setValueAtTime(s.freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.endFreq ?? s.freq), start + s.duration);
    const v = s.volume ?? 0.12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(v, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + s.duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + s.duration + 0.05);
  }
}

/** The registry: key -> default synth. Replace entries or add your own. */
export const SOUNDS: Record<string, () => void> = {
  click: () => synth([{ freq: 660, endFreq: 520, duration: 0.06, type: 'square', volume: 0.05 }]),
  draw: () => synth([{ freq: 320, endFreq: 620, duration: 0.09, volume: 0.07 }]),
  summon: () => synth([{ freq: 220, endFreq: 440, duration: 0.16 }, { freq: 440, endFreq: 660, duration: 0.12, delay: 0.1 }]),
  attack: () => synth([{ freq: 500, endFreq: 140, duration: 0.14, type: 'sawtooth', volume: 0.1 }]),
  hit: () => synth([{ freq: 180, endFreq: 60, duration: 0.16, type: 'square', volume: 0.12 }]),
  heal: () => synth([{ freq: 520, endFreq: 780, duration: 0.18, volume: 0.08 }]),
  death: () => synth([{ freq: 300, endFreq: 55, duration: 0.4, type: 'sawtooth', volume: 0.1 }]),
  status: () => synth([{ freq: 740, endFreq: 700, duration: 0.07, volume: 0.06 }, { freq: 700, endFreq: 660, duration: 0.07, delay: 0.09, volume: 0.06 }]),
  buff: () => synth([{ freq: 440, endFreq: 560, duration: 0.09 }, { freq: 560, endFreq: 700, duration: 0.09, delay: 0.08 }]),
  pull: () => synth([
    { freq: 330, endFreq: 494, duration: 0.12 },
    { freq: 494, endFreq: 659, duration: 0.12, delay: 0.11 },
    { freq: 659, endFreq: 988, duration: 0.22, delay: 0.22, volume: 0.14 },
  ]),
  victory: () => synth([
    { freq: 523, duration: 0.14 },
    { freq: 659, duration: 0.14, delay: 0.13 },
    { freq: 784, duration: 0.14, delay: 0.26 },
    { freq: 1047, duration: 0.3, delay: 0.39, volume: 0.14 },
  ]),
  defeat: () => synth([
    { freq: 392, duration: 0.2, type: 'sawtooth', volume: 0.08 },
    { freq: 330, duration: 0.2, delay: 0.18, type: 'sawtooth', volume: 0.08 },
    { freq: 262, endFreq: 200, duration: 0.4, delay: 0.36, type: 'sawtooth', volume: 0.09 },
  ]),
};

/**
 * Probe public/pack/sounds/ once for per-key override files. Called from
 * BootScene; cheap HEAD requests, misses are expected and silent.
 */
export async function initSounds(): Promise<void> {
  await Promise.all(
    Object.keys(SOUNDS).map(async (key) => {
      for (const ext of ['mp3', 'ogg', 'wav']) {
        try {
          const res = await fetch(`/pack/sounds/${key}.${ext}`, { method: 'HEAD' });
          const type = res.headers.get('content-type') ?? '';
          // Dev servers answer 200 with an HTML fallback — require an audio type.
          if (res.ok && type.startsWith('audio')) {
            fileOverrides.set(key, `/pack/sounds/${key}.${ext}`);
            return;
          }
        } catch {
          // not there — synth default stands
        }
      }
    })
  );
}

export function playSound(key: string): void {
  if (muted) return;
  const file = fileOverrides.get(key);
  if (file) {
    const a = new Audio(file);
    a.volume = 0.5;
    void a.play().catch(() => SOUNDS[key]?.());
    return;
  }
  SOUNDS[key]?.();
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMuted(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('tm-muted', muted ? '1' : '0');
  } catch {
    // fine
  }
  return muted;
}
