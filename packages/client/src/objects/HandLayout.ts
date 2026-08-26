import Phaser from 'phaser';
import type { CardInstance } from '@tcg/shared';
import { CardSprite } from './CardSprite.js';

export interface HandRenderOptions {
  /** Cards the player may currently play (glow + draggable). */
  playableIds: Set<string>;
  onDrop: (card: CardInstance, pointer: Phaser.Input.Pointer) => void;
  onDragStart?: (card: CardInstance) => void;
  /** Plain click (no drag) — used to open the card inspector. */
  onInspect?: (card: CardInstance) => void;
  /** Where newly drawn cards fly in from (your deck counter). */
  deckOrigin?: { x: number; y: number };
}

const HOVER_MS = 130;

/** Fan geometry — 3:4 cards; supplied by layout.ts per orientation. */
export interface HandGeometry {
  w: number;
  h: number;
  maxSpread: number;
  hoverLift: number;
}

/**
 * The player's hand, fanned across the bottom bench like the reference image.
 * Hovering lifts a card smoothly; playable cards drag onto the battlefield;
 * a plain click inspects the card; newly drawn cards fly in from the deck.
 */
export class HandLayout {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly centerX: number;
  private readonly y: number;
  private readonly geo: HandGeometry;
  private knownIds = new Set<string>();

  constructor(
    scene: Phaser.Scene,
    centerX: number,
    y: number,
    geo: HandGeometry = { w: 168, h: 224, maxSpread: 1000, hoverLift: 92 }
  ) {
    this.scene = scene;
    this.centerX = centerX;
    this.y = y;
    this.geo = geo;
    this.container = scene.add.container(0, 0);
  }

  render(hand: CardInstance[], opts: HandRenderOptions): void {
    for (const child of this.container.list) this.scene.tweens.killTweensOf(child);
    this.container.removeAll(true);
    const n = hand.length;
    const newIds = new Set(hand.filter((c) => !this.knownIds.has(c.instanceId)).map((c) => c.instanceId));
    this.knownIds = new Set(hand.map((c) => c.instanceId));
    if (n === 0) return;

    const { w: cardW, h: cardH, maxSpread, hoverLift } = this.geo;
    const spread = Math.min(maxSpread, n * (cardW * 0.72));
    const step = n > 1 ? spread / (n - 1) : 0;
    const startX = this.centerX - spread / 2;
    let drawDelay = 0;

    hand.forEach((card, i) => {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      const x = n > 1 ? startX + step * i : this.centerX;
      const y = this.y + Math.abs(t) * 46; // gentle arc
      const angle = t * 16;
      const playable = opts.playableIds.has(card.instanceId);

      const sprite = new CardSprite(this.scene, x, y, cardW, cardH, card.def, { glow: playable });
      sprite.setAngle(angle);
      sprite.setDepth(i);
      sprite.setData('home', { x, y, angle, depth: i });
      sprite.setInteractive(
        new Phaser.Geom.Rectangle(-cardW / 2, -cardH / 2, cardW, cardH),
        Phaser.Geom.Rectangle.Contains
      );

      // Newly drawn cards fly in from the deck counter.
      if (newIds.has(card.instanceId) && opts.deckOrigin) {
        sprite.setPosition(opts.deckOrigin.x, opts.deckOrigin.y);
        sprite.setScale(0.3);
        sprite.setAlpha(0.4);
        sprite.setAngle(-20);
        this.scene.tweens.add({
          targets: sprite,
          x, y, angle, alpha: 1, scale: 1,
          delay: drawDelay,
          duration: 340,
          ease: 'Cubic.easeOut',
        });
        drawDelay += 90;
      }

      sprite.on('pointerover', () => {
        if (sprite.getData('dragging')) return;
        sprite.setDepth(100);
        this.container.sort('depth');
        this.scene.tweens.killTweensOf(sprite);
        this.scene.tweens.add({
          targets: sprite,
          x, y: this.y - hoverLift, angle: 0, scale: 1.18,
          duration: HOVER_MS,
          ease: 'Cubic.easeOut',
        });
      });
      sprite.on('pointerout', () => {
        if (sprite.getData('dragging')) return;
        sprite.setDepth(i);
        this.container.sort('depth');
        this.scene.tweens.killTweensOf(sprite);
        this.scene.tweens.add({
          targets: sprite,
          x, y, angle, scale: 1,
          duration: HOVER_MS + 60,
          ease: 'Cubic.easeOut',
        });
      });
      // A click that never became a drag opens the inspector.
      sprite.on('pointerup', () => {
        if (sprite.getData('wasDragged')) {
          sprite.setData('wasDragged', false);
          return;
        }
        opts.onInspect?.(card);
      });

      if (playable) {
        this.scene.input.setDraggable(sprite);
        sprite.on('dragstart', () => {
          sprite.setData('dragging', true);
          sprite.setData('wasDragged', true);
          sprite.setDepth(200);
          this.container.sort('depth');
          this.scene.tweens.killTweensOf(sprite);
          this.scene.tweens.add({ targets: sprite, angle: 0, scale: 0.9, duration: 100 });
          opts.onDragStart?.(card);
        });
        sprite.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          sprite.setPosition(dragX, dragY);
        });
        sprite.on('dragend', (pointer: Phaser.Input.Pointer) => {
          sprite.setData('dragging', false);
          // Glide back home; a successful play re-renders everything anyway.
          sprite.setDepth(i);
          this.container.sort('depth');
          this.scene.tweens.killTweensOf(sprite);
          this.scene.tweens.add({
            targets: sprite,
            x, y, angle, scale: 1,
            duration: 180,
            ease: 'Cubic.easeOut',
          });
          opts.onDrop(card, pointer);
        });
      }

      this.container.add(sprite);
    });
    this.container.sort('depth');
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
