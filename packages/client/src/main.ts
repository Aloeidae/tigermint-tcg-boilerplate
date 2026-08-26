import Phaser from 'phaser';
import { initTma } from './tma.js';
import { H, W } from './layout.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { DeckScene } from './scenes/DeckScene.js';
import { GameScene } from './scenes/GameScene.js';

// Inside Telegram, behave like a Mini App; elsewhere this is a no-op.
initTma();

// The design space is portrait on phones/Mini Apps, landscape on desktop —
// see src/layout.ts. Scale.FIT letterboxes it into the real window.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#000000',
  width: W,
  height: H,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, DeckScene, GameScene],
});
