import Phaser from 'phaser';
import { initSounds } from '../audio.js';

/**
 * Preload hook. The boilerplate draws all its art procedurally, so there is
 * little to load — put your real assets here:
 *
 *   this.load.image('bg-menu', 'assets/menu-background.png');   // menu backdrop
 *   this.load.image('bg-board', 'assets/board-background.png'); // battle backdrop
 *
 * If a 'bg-menu' / 'bg-board' texture exists, the scenes draw it instead of
 * their procedural backgrounds — that's the whole integration.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Optional branding art, all dropped into public/pack/ — missing files
    // are fine, every one has a procedural fallback:
    //   back.jpeg / back.png     -> the card back
    //   banner.png / banner.jpeg -> the menu banner (replaces the title text)
    this.load.image('card-back', '/pack/back.jpeg');
    this.load.image('menu-banner', '/pack/banner.png');
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === 'card-back') this.load.image('card-back', '/pack/back.png');
      if (file.key === 'menu-banner') this.load.image('menu-banner', '/pack/banner.jpeg');
    });
    // this.load.image('bg-board', 'assets/board-background.png');
  }

  create(): void {
    // Look for per-sound override files in public/pack/sounds/ (audio.ts).
    void initSounds();
    // Let the webfonts (index.html) arrive before any text renders, so Phaser
    // doesn't rasterize fallback fonts. Capped so a slow network never blocks.
    const start = () => this.scene.start('Menu');
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      void fonts.load('400 32px "Lilita One"');
      void fonts.load('600 20px Inter');
      void fonts.load('500 16px "JetBrains Mono"');
      Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(start, start);
    } else {
      start();
    }
  }
}
