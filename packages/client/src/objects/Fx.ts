import Phaser from 'phaser';
import type { CardDef } from '@tcg/shared';
import { THEME } from '../theme.js';
import { CardSprite } from './CardSprite.js';

const DEPTH = 800;

/**
 * Self-cleaning visual feedback for game actions: floating numbers, impact
 * bursts, death puffs, turn banners, and the opponent's played-card showcase.
 * All of it is procedural (no assets) and colored from theme.ts.
 */

/** Floating text that drifts up and fades (damage numbers, heals, buffs). */
export function floatText(scene: Phaser.Scene, x: number, y: number, text: string, color: string): void {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: THEME.fonts.body,
      fontSize: '38px',
      color,
      fontStyle: 'bold',
      stroke: '#101319',
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setDepth(DEPTH);
  scene.tweens.add({
    targets: t,
    y: y - 90,
    alpha: 0,
    scale: { from: 1, to: 1.25 },
    duration: 950,
    ease: 'Cubic.easeOut',
    onComplete: () => t.destroy(),
  });
}

/** Radial burst of shards at an impact point. */
export function impact(scene: Phaser.Scene, x: number, y: number, color = THEME.fx.impact): void {
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
    const dist = 46 + Math.random() * 36;
    const shard = scene.add
      .triangle(x, y, 0, -7, 6, 7, -6, 7, color)
      .setDepth(DEPTH)
      .setRotation(angle + Math.PI / 2);
    scene.tweens.add({
      targets: shard,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      scale: 0.3,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => shard.destroy(),
    });
  }
  const ring = scene.add.circle(x, y, 12).setStrokeStyle(4, color, 0.9).setDepth(DEPTH);
  scene.tweens.add({
    targets: ring,
    radius: 60,
    alpha: 0,
    duration: 320,
    onComplete: () => ring.destroy(),
  });
}

/** Soft puff of smoke where a creature died. */
export function deathPuff(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const c = scene.add
      .circle(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, 14 + Math.random() * 14, THEME.fx.deathPuff, 0.7)
      .setDepth(DEPTH);
    scene.tweens.add({
      targets: c,
      y: c.y - 40 - Math.random() * 30,
      alpha: 0,
      scale: 1.8,
      duration: 620 + Math.random() * 250,
      ease: 'Sine.easeOut',
      onComplete: () => c.destroy(),
    });
  }
}

/** Brief camera shake for hits to a player's face. */
export function shake(scene: Phaser.Scene, strong = false): void {
  scene.cameras.main.shake(strong ? 220 : 120, strong ? 0.008 : 0.004);
}

/** Big center banner, e.g. "Your Turn". A new banner replaces the last one. */
export function turnBanner(scene: Phaser.Scene, width: number, height: number, text: string, color: string): void {
  (scene.data.get('fx-turn-banner') as Phaser.GameObjects.Text | undefined)?.destroy();
  const t = scene.add
    .text(width / 2, height * 0.4, text, {
      fontFamily: THEME.fonts.display,
      fontSize: '72px',
      color,
      stroke: THEME.hud.bannerStroke,
      strokeThickness: 10,
    })
    .setOrigin(0.5)
    .setDepth(DEPTH + 10)
    .setAlpha(0)
    .setScale(0.8);
  scene.data.set('fx-turn-banner', t);
  // One yoyo tween (in -> hold -> out): callback-scheduled tweens proved
  // unreliable here, a single tween always completes.
  scene.tweens.add({
    targets: t,
    alpha: 1,
    scale: 1,
    duration: 250,
    ease: 'Back.easeOut',
    yoyo: true,
    hold: 800,
    onComplete: () => t.destroy(),
  });
}

/** Show a card the opponent just played, large in the center, then fade. */
export function showcaseCard(scene: Phaser.Scene, width: number, height: number, def: CardDef): void {
  const card = new CardSprite(scene, width / 2, height * 0.42, 255, 340, def);
  card.setDepth(DEPTH + 5).setAlpha(0).setScale(0.7);
  scene.tweens.add({
    targets: card,
    alpha: 1,
    scale: 1,
    duration: 220,
    ease: 'Back.easeOut',
    yoyo: true,
    hold: 950,
    onComplete: () => card.destroy(),
  });
}
