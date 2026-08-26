import Phaser from 'phaser';
import { THEME } from '../theme.js';

/** The targeting arrow drawn while picking an attack target. */
export class TargetArrow {
  private g: Phaser.GameObjects.Graphics;
  private fromX = 0;
  private fromY = 0;
  private active = false;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(500);
  }

  show(fromX: number, fromY: number): void {
    this.fromX = fromX;
    this.fromY = fromY;
    this.active = true;
  }

  update(toX: number, toY: number): void {
    if (!this.active) return;
    this.g.clear();
    this.g.lineStyle(6, THEME.fx.arrow, 0.9);
    this.g.lineBetween(this.fromX, this.fromY, toX, toY);
    const angle = Math.atan2(toY - this.fromY, toX - this.fromX);
    const size = 22;
    this.g.fillStyle(THEME.fx.arrow, 0.95);
    this.g.fillTriangle(
      toX, toY,
      toX - size * Math.cos(angle - 0.45), toY - size * Math.sin(angle - 0.45),
      toX - size * Math.cos(angle + 0.45), toY - size * Math.sin(angle + 0.45)
    );
  }

  hide(): void {
    this.active = false;
    this.g.clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.g.destroy();
  }
}
