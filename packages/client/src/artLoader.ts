import Phaser from 'phaser';
import type { CardDef } from '@tcg/shared';

const failed = new Set<string>();

/**
 * Load card-art image URLs (NFT images) into Phaser textures as `art:<def.id>`.
 * Resolves when the load pass finishes; cards whose art fails to load simply
 * keep their drawn placeholder. Returns true if anything new was loaded.
 */
export function ensureArtTextures(scene: Phaser.Scene, defs: CardDef[]): Promise<boolean> {
  const toLoad = defs.filter(
    (d) =>
      d.art &&
      (/^https?:\/\//.test(d.art) || d.art.startsWith('/')) && // remote URL or local /public asset
      !scene.textures.exists(`art:${d.id}`) &&
      !failed.has(`art:${d.id}`)
  );
  if (toLoad.length === 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    for (const d of toLoad) {
      scene.load.image(`art:${d.id}`, d.art!);
    }
    const onError = (file: Phaser.Loader.File) => failed.add(file.key);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      resolve(true);
    });
    scene.load.start();
  });
}
