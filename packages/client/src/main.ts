import Phaser from 'phaser';
import { initTma } from './tma.js';
import { H, W } from './layout.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { DeckScene } from './scenes/DeckScene.js';
import { GameScene } from './scenes/GameScene.js';
import { LayoutScene } from './scenes/LayoutScene.js';

// Inside Telegram, behave like a Mini App; elsewhere this is a no-op.
initTma();

// The design space is portrait on phones/Mini Apps, landscape on desktop —
// see src/layout.ts. Scale.FIT letterboxes it into the real window.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#000000',
  width: W,
  height: H,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, DeckScene, GameScene, LayoutScene],
});

// Dev builds expose the game for tooling/automation (e.g. pumping frames
// while the tab is hidden — Phaser pauses its loop on document.hidden).
if (import.meta.env.DEV) {
  (window as unknown as { __game?: Phaser.Game }).__game = game;
}
