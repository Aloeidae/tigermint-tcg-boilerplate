import Phaser from 'phaser';
import type { OverlayScrim } from '@tcg/shared';

/**
 * The overlay card style's legibility panel: a colorable alpha-fade gradient
 * hugging the bottom (or top) of the card, optionally filled with a tinted
 * procedural pattern (stripes / dots / grid / noise) or a tiled image from
 * public/pack/scrim.png ('pack-scrim' texture, probed in BootScene).
 *
 * Each distinct (spec × card size) renders ONCE into a cached CanvasTexture
 * — canvas 2D gives us gradients and pattern fills natively, so the whole
 * panel is a single image instead of a Graphics/TileSprite/mask sandwich.
 */

const DEFAULTS: Required<Omit<OverlayScrim, 'pattern' | 'patternColor' | 'patternAlpha' | 'patternScale'>> = {
  edge: 'bottom',
  height: 0.48,
  color: '#000000',
  alpha: 0.78,
  fade: 0.45,
};

/** Corner radius matching the card border stroke in CardSprite. */
const CORNER = 10;

export function addScrim(
  scene: Phaser.Scene,
  spec: OverlayScrim,
  w: number,
  h: number
): Phaser.GameObjects.Image | null {
  const edge = spec.edge ?? DEFAULTS.edge;
  const height = Math.round(h * clamp01(spec.height ?? DEFAULTS.height));
  if (height < 2) return null;
  const key = `scrim:${Math.round(w)}x${Math.round(h)}:${hash(JSON.stringify({ ...spec }))}`;

  if (!scene.textures.exists(key)) {
    const canvas = scene.textures.createCanvas(key, Math.max(2, Math.round(w)), height);
    if (!canvas) return null;
    const ctx = canvas.getContext();
    paintScrim(scene, ctx, spec, Math.round(w), height, edge);
    canvas.refresh();
  }
  const y = edge === 'bottom' ? h / 2 - height / 2 : -h / 2 + height / 2;
  return scene.add.image(0, y, key);
}

function paintScrim(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  spec: OverlayScrim,
  w: number,
  height: number,
  edge: 'bottom' | 'top'
): void {
  ctx.clearRect(0, 0, w, height);
  ctx.save();

  // Clip: rounded on the two card corners this panel touches, square on the
  // side that fades into the art.
  ctx.beginPath();
  const r = Math.min(CORNER, height / 2);
  if (edge === 'bottom') {
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, height - r);
    ctx.quadraticCurveTo(w, height, w - r, height);
    ctx.lineTo(r, height);
    ctx.quadraticCurveTo(0, height, 0, height - r);
  } else {
    ctx.moveTo(0, height);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, height);
  }
  ctx.closePath();
  ctx.clip();

  // 1. Base color at full coverage.
  ctx.fillStyle = spec.color ?? DEFAULTS.color;
  ctx.fillRect(0, 0, w, height);

  // 2. Optional pattern on top.
  const tile = patternTile(scene, spec);
  if (tile) {
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      ctx.globalAlpha = clamp01(spec.patternAlpha ?? 0.35);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, height);
      ctx.globalAlpha = 1;
    }
  }

  // 3. One fade for everything: alpha at the outer edge, transparent where
  // the panel meets the art ('destination-in' keeps only the gradient alpha).
  const fade = clamp01(spec.fade ?? DEFAULTS.fade);
  const alpha = clamp01(spec.alpha ?? DEFAULTS.alpha);
  const grad =
    edge === 'bottom'
      ? ctx.createLinearGradient(0, 0, 0, height)
      : ctx.createLinearGradient(0, height, 0, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(Math.min(1, fade), `rgba(0,0,0,${alpha})`);
  grad.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/** A small canvas tile for the chosen pattern, tinted patternColor. */
function patternTile(scene: Phaser.Scene, spec: OverlayScrim): HTMLCanvasElement | null {
  const kind = spec.pattern ?? 'none';
  if (kind === 'none') return null;
  const scale = Math.max(0.25, spec.patternScale ?? 1);
  const color = spec.patternColor ?? '#ffffff';
  const size = Math.max(4, Math.round(24 * scale));
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d');
  if (!ctx) return null;

  if (kind === 'image') {
    // Tiled from public/pack/scrim.png, scaled by patternScale.
    if (!scene.textures.exists('pack-scrim')) return null;
    const src = scene.textures.get('pack-scrim').getSourceImage() as CanvasImageSource & { width: number; height: number };
    if (!src.width || !src.height) return null;
    const tw = Math.max(8, Math.round(src.width * scale));
    const th = Math.max(8, Math.round((src.height * tw) / src.width));
    tile.width = tw;
    tile.height = th;
    ctx.drawImage(src, 0, 0, tw, th);
    return tile;
  }

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const u = size / 24; // pattern units so every kind scales together
  switch (kind) {
    case 'stripes':
      ctx.lineWidth = 3 * u;
      // Diagonals drawn past the edges so the tile repeats seamlessly.
      for (let i = -1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * size - size / 2, size + 2);
        ctx.lineTo(i * size + size / 2, -2);
        ctx.stroke();
      }
      break;
    case 'dots':
      for (const [cx, cy] of [
        [size * 0.25, size * 0.25],
        [size * 0.75, size * 0.75],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 2 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'grid':
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.moveTo(0.5, 0);
      ctx.lineTo(0.5, size);
      ctx.moveTo(0, 0.5);
      ctx.lineTo(size, 0.5);
      ctx.stroke();
      break;
    case 'noise':
      for (let i = 0; i < size * size * 0.12; i++) {
        ctx.globalAlpha = 0.3 + Math.random() * 0.7;
        ctx.fillRect(Math.random() * size, Math.random() * size, u, u);
      }
      ctx.globalAlpha = 1;
      break;
  }
  return tile;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
