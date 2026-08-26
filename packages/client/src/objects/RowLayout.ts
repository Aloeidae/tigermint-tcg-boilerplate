import Phaser from 'phaser';
import type { CreatureOnBoard } from '@tcg/shared';
import { CardSprite } from './CardSprite.js';
import { THEME } from '../theme.js';

export interface RowRenderOptions {
  /** Creatures that should glow (e.g. ready attackers). */
  glowIds?: Set<string>;
  /** Creatures rendered dimmed (e.g. already attacked). */
  dimIds?: Set<string>;
  /** Creatures that can be picked up and dragged (attackers). */
  draggableIds?: Set<string>;
  onCreatureClick?: (instanceId: string) => void;
  onCreatureDragStart?: (instanceId: string, sprite: CardSprite) => void;
  onCreatureDrop?: (instanceId: string, pointer: Phaser.Input.Pointer) => void;
}

/**
 * One player's battlefield row: fixed slots with diamond markers (a nod to the
 * Wildfrost reference) and a CardSprite per creature. Also renders the pulsing
 * target highlights used while aiming equipment, spells, and attacks.
 */
export class RowLayout {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly centerX: number;
  private readonly y: number;
  private readonly cardW: number;
  private readonly cardH: number;
  private readonly spacing: number;
  private readonly slots: number;
  /** Slots per line; extra lines wrap `rowGap` further down (portrait). */
  private readonly cols: number;
  private readonly rowGap: number;
  private sprites = new Map<string, CardSprite>();
  private highlights: Phaser.GameObjects.GameObject[] = [];
  private everRendered = false;

  // Cards are 3:4 — the most common AI-generation aspect, so full-art
  // images drop in without cropping.
  constructor(
    scene: Phaser.Scene,
    centerX: number,
    y: number,
    slots: number,
    cardW = 150,
    cardH = 200,
    spacing = 172,
    cols = 99,
    rowGap = 0
  ) {
    this.scene = scene;
    this.centerX = centerX;
    this.y = y;
    this.slots = slots;
    this.cardW = cardW;
    this.cardH = cardH;
    this.spacing = spacing;
    this.cols = Math.min(cols, slots);
    this.rowGap = rowGap;
    this.container = scene.add.container(0, 0);
  }

  slotX(i: number): number {
    const col = i % this.cols;
    const lineStart = Math.floor(i / this.cols) * this.cols;
    // Center each line by how many slots it actually holds.
    const lineCount = Math.min(this.cols, this.slots - lineStart);
    return this.centerX + (col - (lineCount - 1) / 2) * this.spacing;
  }

  slotY(i: number): number {
    return this.y + Math.floor(i / this.cols) * this.rowGap;
  }

  render(row: (CreatureOnBoard | null)[], opts: RowRenderOptions = {}): void {
    const previousIds = new Set(this.sprites.keys());
    for (const child of this.container.list) this.scene.tweens.killTweensOf(child);
    this.container.removeAll(true);
    this.sprites.clear();
    this.highlights = [];

    const markers = this.scene.add.graphics();
    this.container.add(markers);

    for (let i = 0; i < this.slots; i++) {
      const x = this.slotX(i);
      const sy = this.slotY(i);
      const creature = row[i];
      if (!creature) {
        // Empty slot: outlined diamond marker.
        markers.lineStyle(3, THEME.board.slotMarker, 0.35);
        const d = 26;
        markers.strokePoints(
          [{ x, y: sy - d }, { x: x + d, y: sy }, { x, y: sy + d }, { x: x - d, y: sy }],
          true
        );
        continue;
      }
      const sprite = new CardSprite(this.scene, x, sy, this.cardW, this.cardH, creature.def, {
        creature,
        glow: opts.glowIds?.has(creature.instanceId),
        dim: opts.dimIds?.has(creature.instanceId),
      });
      // Freshly summoned creatures pop into their slot.
      if (previousIds.size > 0 || this.everRendered) {
        if (!previousIds.has(creature.instanceId)) {
          sprite.setScale(0.2);
          sprite.setAlpha(0);
          this.scene.tweens.add({
            targets: sprite, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut',
          });
        }
      }
      const interactive = opts.onCreatureClick || opts.onCreatureDrop;
      if (interactive) {
        sprite.setInteractive(
          new Phaser.Geom.Rectangle(-this.cardW / 2, -this.cardH / 2, this.cardW, this.cardH),
          Phaser.Geom.Rectangle.Contains
        );
        if (opts.onCreatureClick) {
          sprite.on('pointerdown', () => opts.onCreatureClick!(creature.instanceId));
        }
        if (opts.draggableIds?.has(creature.instanceId) && opts.onCreatureDrop) {
          // Dragging aims the attack arrow; the creature itself stays put.
          this.scene.input.setDraggable(sprite);
          sprite.on('dragstart', () => opts.onCreatureDragStart?.(creature.instanceId, sprite));
          sprite.on('dragend', (pointer: Phaser.Input.Pointer) =>
            opts.onCreatureDrop!(creature.instanceId, pointer)
          );
        }
      }
      this.container.add(sprite);
      this.sprites.set(creature.instanceId, sprite);
    }
    this.everRendered = true;
  }

  /**
   * Soft pulsing glow on specific creatures — the contextual "you can target
   * these" cue shown while dragging equipment/spells or aiming an attack.
   */
  highlight(ids: Set<string>, color: number): void {
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (!s) continue;
      const halo = this.scene.add
        .rectangle(s.x, s.y, this.cardW + 22, this.cardH + 22, color, 0.16)
        .setStrokeStyle(4, color, 0.9);
      this.scene.tweens.add({
        targets: halo,
        alpha: { from: 1, to: 0.55 },
        scaleX: { from: 1, to: 1.05 },
        scaleY: { from: 1, to: 1.04 },
        yoyo: true,
        repeat: -1,
        duration: 480,
        ease: 'Sine.easeInOut',
      });
      this.container.add(halo);
      this.highlights.push(halo);
    }
  }

  clearHighlights(): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = [];
  }

  /** Which slot (empty or not) is under this point, or null. */
  slotAt(x: number, y: number): number | null {
    for (let i = 0; i < this.slots; i++) {
      if (
        Math.abs(x - this.slotX(i)) <= this.spacing / 2 &&
        Math.abs(y - this.slotY(i)) <= this.cardH * (this.rowGap > 0 ? 0.55 : 0.75)
      ) {
        return i;
      }
    }
    return null;
  }

  /** Which creature is under this point, or null. */
  creatureAt(x: number, y: number, row: (CreatureOnBoard | null)[]): string | null {
    const slot = this.slotAt(x, y);
    if (slot === null) return null;
    return row[slot]?.instanceId ?? null;
  }

  spriteFor(instanceId: string): CardSprite | undefined {
    return this.sprites.get(instanceId);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
