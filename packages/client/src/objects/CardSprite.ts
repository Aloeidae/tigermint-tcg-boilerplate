import Phaser from 'phaser';
import { creatureSkills, effectText, getStatus, skillLine, type CardDef, type CreatureOnBoard } from '@tcg/shared';
import { THEME } from '../theme.js';

export interface CardSpriteOptions {
  /** Board creature to show live stats for (hand cards omit this). */
  creature?: CreatureOnBoard;
  /** Render as a face-down card back. */
  faceDown?: boolean;
  /** Glow around the card; defaults to the "playable" color. */
  glow?: boolean;
  /** Override the glow color (e.g. targeting highlights). */
  glowColor?: number;
  /** Dim the card (e.g. exhausted attacker). */
  dim?: boolean;
}

/**
 * A Wildfrost-inspired card frame drawn entirely with Graphics/Text, so the
 * boilerplate needs no bundled art. If a texture `art:<def.id>` exists (loaded
 * from an NFT image URL) it is used for the art window; otherwise a colored
 * placeholder derived from the card id is drawn. All colors come from theme.ts.
 */
export class CardSprite extends Phaser.GameObjects.Container {
  readonly def: CardDef;
  readonly cardWidth: number;
  readonly cardHeight: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    def: CardDef,
    opts: CardSpriteOptions = {}
  ) {
    super(scene, x, y);
    this.def = def;
    this.cardWidth = w;
    this.cardHeight = h;

    const T = THEME.card;
    const g = scene.add.graphics();
    this.add(g);

    if (opts.glow) {
      g.fillStyle(opts.glowColor ?? THEME.fx.glowPlayable, 0.35);
      g.fillRoundedRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 16);
    }

    if (opts.faceDown) {
      // A 'card-back' texture (public/pack/back.jpeg, loaded in BootScene)
      // becomes the card back; otherwise a procedural back is drawn.
      if (scene.textures.exists('card-back')) {
        const img = scene.add.image(0, 0, 'card-back');
        coverCrop(scene, img, 'card-back', w, h);
        this.add(img);
        const border = scene.add.graphics();
        border.lineStyle(3, T.backEdge, 1);
        border.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.add(border);
        scene.add.existing(this);
        return;
      }
      g.fillStyle(T.back, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      g.lineStyle(3, T.backEdge, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
      g.lineStyle(2, T.backEmblem, 1);
      const d = Math.min(w, h) * 0.22;
      g.strokePoints(
        [
          { x: 0, y: -d }, { x: d, y: 0 }, { x: 0, y: d }, { x: -d, y: 0 }, { x: 0, y: -d },
        ],
        true
      );
      scene.add.existing(this);
      return;
    }

    // Full-art card: the (NFT) image IS the card. Only live game values are
    // overlaid — cost, current creature stats, equipment count. Name, text
    // and skills are part of the owner's art (skills come from metadata).
    const fullArtKey = `art:${def.id}`;
    if (def.fullArt && def.art && scene.textures.exists(fullArtKey)) {
      const img = scene.add.image(0, 0, fullArtKey);
      coverCrop(scene, img, fullArtKey, w, h);
      this.add(img);
      const gTop = scene.add.graphics();
      this.add(gTop);
      gTop.lineStyle(3, T.frame, 1);
      gTop.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      const sticker = def.game?.kind === 'sticker' ? def.game : null;
      if (sticker) {
        // Pokemon-mode sticker: no mana cost — type emoji top-left, HP
        // top-right, energy pips along the bottom.
        const costSpot = badgeSpot(w, h, 'fullArt', 'cost');
        this.typeEmoji(scene, costSpot, sticker.typeEmoji ?? TYPE_EMOJI[sticker.type] ?? '👀');
        const hp = opts.creature?.health ?? sticker.hp;
        const maxHp = opts.creature?.maxHealth ?? sticker.hp;
        const hpSpot = badgeSpot(w, h, 'fullArt', 'health');
        this.badge(scene, gTop, hpSpot.x, hpSpot.y, hpSpot.size, T.healthGem, String(hp), hp < maxHp ? T.damagedText : T.gemText);
        if (opts.creature) this.energyStrip(scene, opts.creature, w, h);
      } else if (!def.game) {
        const cost = badgeSpot(w, h, 'fullArt', 'cost');
        this.badge(scene, gTop, cost.x, cost.y, cost.size, T.costGem, String(def.cost));
        if (def.type === 'creature') {
          const atk = opts.creature?.attack ?? def.attack ?? 0;
          const hp = opts.creature?.health ?? def.health ?? 1;
          const maxHp = opts.creature?.maxHealth ?? def.health ?? 1;
          const atkColor = atk > (def.attack ?? 0) ? T.buffedText : T.gemText;
          const hpColor = hp < maxHp ? T.damagedText : T.gemText;
          const atkSpot = badgeSpot(w, h, 'fullArt', 'attack');
          const hpSpot = badgeSpot(w, h, 'fullArt', 'health');
          this.badge(scene, gTop, atkSpot.x, atkSpot.y, atkSpot.size, T.attackGem, String(atk), atkColor);
          this.badge(scene, gTop, hpSpot.x, hpSpot.y, hpSpot.size, T.healthGem, String(hp), hpColor);
        }
      }
      if (opts.creature && opts.creature.equipment.length > 0) {
        const eq = badgeSpot(w, h, 'fullArt', 'equip');
        this.badge(scene, gTop, eq.x, eq.y, eq.size, T.equipChip, `⚔${opts.creature.equipment.length}`);
      }
      if (opts.creature) this.statusStrip(scene, opts.creature, w, h);
      if (opts.dim) this.add(scene.add.rectangle(0, 0, w, h, 0x000000, 0.35));
      this.applyFoil(opts.dim);
      scene.add.existing(this);
      return;
    }

    const tint = T.typeTints[def.type] ?? T.typeTints.creature;

    // Outer frame + card face.
    g.fillStyle(T.frame, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.fillStyle(T.face, 1);
    g.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 9);
    g.lineStyle(2, tint, 1);
    g.strokeRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 8);

    // Art window.
    const artX = -w / 2 + 10;
    const artY = -h / 2 + 10;
    const artW = w - 20;
    const artH = h * 0.42;
    const artKey = `art:${def.id}`;
    if (def.art && scene.textures.exists(artKey)) {
      const img = scene.add.image(artX + artW / 2, artY + artH / 2, artKey);
      coverCrop(scene, img, artKey, artW, artH);
      this.add(img);
    } else {
      g.fillStyle(placeholderColor(def.id), 1);
      g.fillRect(artX, artY, artW, artH);
      const initial = scene.add
        .text(artX + artW / 2, artY + artH / 2, def.name.charAt(0).toUpperCase(), {
          fontFamily: THEME.fonts.display,
          fontSize: `${Math.round(artH * 0.55)}px`,
          color: T.artInitial,
        })
        .setOrigin(0.5);
      this.add(initial);
    }
    g.lineStyle(2, T.frame, 1);
    g.strokeRect(artX, artY, artW, artH);

    // Name banner.
    const bannerY = artY + artH + 4;
    const bannerH = Math.max(18, h * 0.11);
    g.fillStyle(T.banner, 1);
    g.fillRoundedRect(artX, bannerY, artW, bannerH, 5);
    const name = scene.add
      .text(0, bannerY + bannerH / 2, fitName(def.name), {
        fontFamily: THEME.fonts.body,
        fontSize: `${Math.round(bannerH * 0.52)}px`,
        color: T.bannerText,
      })
      .setOrigin(0.5);
    this.add(name);

    // Skill line (icons + names). Board creatures show effective skills,
    // including ones granted by attached equipment. Pokemon-mode stickers
    // show their trait here instead; their moves fill the body text below.
    const sticker = def.game?.kind === 'sticker' ? def.game : null;
    const skillRefs = opts.creature ? creatureSkills(opts.creature) : def.skills;
    const skills = sticker ? (sticker.trait ? `✨ ${sticker.trait.name}` : '') : skillLine(skillRefs);
    let bodyY = bannerY + bannerH + h * 0.13;
    if (skills) {
      const skillsText = scene.add
        .text(0, bannerY + bannerH + h * 0.05, skills, {
          fontFamily: THEME.fonts.body,
          fontSize: `${Math.round(h * 0.052)}px`,
          color: T.skillText,
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: artW - 4 },
        })
        .setOrigin(0.5, 0);
      this.add(skillsText);
      bodyY = bannerY + bannerH + h * 0.17;
    }

    // Rules text. Stickers list their moves (cost pips · name · damage);
    // other pokemon-mode cards print their game text.
    let bodyText: string;
    if (sticker) {
      bodyText = sticker.moves
        .map((m) => `${costLine(m.cost)} ${m.name}${m.damage || m.damageText ? ` · ${m.damageText || m.damage}` : ''}`)
        .join('\n');
    } else if (def.game && 'text' in def.game && def.game.text) {
      bodyText = def.game.text;
    } else {
      const rules = def.text ?? effectText(def.effect) ?? '';
      bodyText = def.type === 'equipment' ? `+${def.attackBonus ?? 0}/+${def.healthBonus ?? 0}` : rules;
    }
    if (bodyText) {
      const body = scene.add
        .text(0, bodyY, bodyText, {
          fontFamily: THEME.fonts.body,
          fontSize: `${Math.round(h * 0.055)}px`,
          color: T.bodyText,
          align: 'center',
          wordWrap: { width: artW - 6 },
        })
        .setOrigin(0.5);
      this.add(body);
    }

    // Live badges, placed per THEME.card.badges.framed.
    if (sticker) {
      // Pokemon-mode: type emoji instead of a mana cost, HP top-right,
      // retreat cost tucked into the bottom-right corner.
      const costSpot = badgeSpot(w, h, 'framed', 'cost');
      this.typeEmoji(scene, costSpot, sticker.typeEmoji ?? TYPE_EMOJI[sticker.type] ?? '👀');
      const hp = opts.creature?.health ?? sticker.hp;
      const maxHp = opts.creature?.maxHealth ?? sticker.hp;
      const hpSpot = badgeSpot(w, h, 'framed', 'health');
      this.badge(scene, g, hpSpot.x, hpSpot.y, hpSpot.size, T.healthGem, String(hp), hp < maxHp ? T.damagedText : T.gemText);
      if (sticker.swapCost > 0) {
        const swap = scene.add
          .text(w / 2 - w * 0.06, h / 2 - h * 0.045, `↩${sticker.swapCost}`, {
            fontFamily: THEME.fonts.body, fontSize: `${Math.round(h * 0.05)}px`,
            color: T.skillText, fontStyle: 'bold',
          })
          .setOrigin(1, 0.5);
        this.add(swap);
      }
    } else if (def.game?.kind === 'reaction') {
      const costSpot = badgeSpot(w, h, 'framed', 'cost');
      this.typeEmoji(scene, costSpot, def.game.typeEmoji ?? TYPE_EMOJI[def.game.type] ?? '👀');
    } else {
      const cost = badgeSpot(w, h, 'framed', 'cost');
      this.badge(scene, g, cost.x, cost.y, cost.size, T.costGem, String(def.cost));
      if (def.type === 'creature') {
        const atk = opts.creature?.attack ?? def.attack ?? 0;
        const hp = opts.creature?.health ?? def.health ?? 1;
        const maxHp = opts.creature?.maxHealth ?? def.health ?? 1;
        const baseAtk = def.attack ?? 0;
        const atkColor = atk > baseAtk ? T.buffedText : T.gemText;
        const hpColor = hp < maxHp ? T.damagedText : T.gemText;
        const atkSpot = badgeSpot(w, h, 'framed', 'attack');
        const hpSpot = badgeSpot(w, h, 'framed', 'health');
        this.badge(scene, g, atkSpot.x, atkSpot.y, atkSpot.size, T.attackGem, String(atk), atkColor);
        this.badge(scene, g, hpSpot.x, hpSpot.y, hpSpot.size, T.healthGem, String(hp), hpColor);
      }
    }

    // Equipment chips on a board creature.
    if (opts.creature && opts.creature.equipment.length > 0) {
      const eq = badgeSpot(w, h, 'framed', 'equip');
      this.badge(scene, g, eq.x, eq.y, eq.size, T.equipChip, `⚔${opts.creature.equipment.length}`);
    }

    if (opts.creature) this.statusStrip(scene, opts.creature, w, h);
    if (opts.creature && sticker) this.energyStrip(scene, opts.creature, w, h);

    if (opts.dim) {
      const shade = scene.add.rectangle(0, 0, w, h, 0x000000, 0.35);
      this.add(shade);
    }

    this.applyFoil(opts.dim);
    scene.add.existing(this);
  }

  /** Foil shine on high-rarity cards (see THEME.card.foil). Dimmed cards stay matte. */
  private applyFoil(dim?: boolean): void {
    if (dim) return;
    const spec = THEME.card.foil[(this.def.rarity ?? '').toUpperCase()];
    if (spec && this.postFX) this.postFX.addShine(spec.speed, spec.lineWidth, spec.gradient);
  }

  /** A bare emoji where a badge would sit (pokemon-mode type marker). */
  private typeEmoji(scene: Phaser.Scene, spot: { x: number; y: number; size: number }, emoji: string): void {
    const t = scene.add
      .text(spot.x + spot.size / 2, spot.y + spot.size / 2, emoji, {
        fontFamily: THEME.fonts.body,
        fontSize: `${Math.round(spot.size * 0.9)}px`,
      })
      .setOrigin(0.5);
    this.add(t);
  }

  /** Attached energy pips + Tool marker along a board sticker's bottom edge. */
  private energyStrip(scene: Phaser.Scene, creature: CreatureOnBoard, w: number, h: number): void {
    const pips = (creature.reactions ?? [])
      .map((r) => {
        const g = r.def.game;
        return g?.kind === 'reaction' ? g.typeEmoji ?? TYPE_EMOJI[g.type] ?? '👀' : '👀';
      })
      .join('');
    const gift = creature.gift ? '🎁' : '';
    if (!pips && !gift) return;
    const y = h / 2 - h * 0.045;
    const t = scene.add
      .text(-w / 2 + w * 0.06, y, `${pips}${gift}`, {
        fontFamily: THEME.fonts.body,
        fontSize: `${Math.round(w * 0.11)}px`,
      })
      .setOrigin(0, 0.5);
    // Keep the strip inside the card even with lots of energy attached.
    const maxW = w * 0.8;
    if (t.width > maxW) t.setScale(maxW / t.width);
    const bg = scene.add.graphics();
    bg.fillStyle(THEME.card.statusChip, 0.75);
    bg.fillRoundedRect(-w / 2 + w * 0.03, y - t.height / 2 - 2, Math.min(t.width, maxW) + w * 0.06, t.height + 4, 5);
    this.add(bg);
    this.add(t);
  }

  /** Active statuses on a board creature: a compact icon pill at top-center. */
  private statusStrip(scene: Phaser.Scene, creature: CreatureOnBoard, w: number, h: number): void {
    if (creature.statuses.length === 0) return;
    const T = THEME.card;
    const label = creature.statuses
      .map((s) => `${getStatus(s.key)?.icon ?? '?'}${s.value !== undefined ? s.value : ''}`)
      .join(' ');
    const y = -h / 2 + h * 0.075;
    const t = scene.add
      .text(0, y, label, {
        fontFamily: THEME.fonts.body,
        fontSize: `${Math.round(w * 0.09)}px`,
        color: T.statusText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const bg = scene.add.graphics();
    const pw = t.width + 12;
    const ph = t.height + 4;
    bg.fillStyle(T.statusChip, 0.85);
    bg.fillRoundedRect(-pw / 2, y - ph / 2, pw, ph, 6);
    this.add(bg);
    this.add(t);
  }

  private badge(
    scene: Phaser.Scene,
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    color: number,
    label: string,
    textColor: string = THEME.card.gemText
  ): void {
    g.fillStyle(0x2b1d10, 1);
    g.fillCircle(x + size / 2, y + size / 2, size / 2 + 2);
    g.fillStyle(color, 1);
    g.fillCircle(x + size / 2, y + size / 2, size / 2);
    const t = scene.add
      .text(x + size / 2, y + size / 2, label, {
        fontFamily: THEME.fonts.body,
        fontSize: `${Math.round(size * 0.62)}px`,
        color: textColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add(t);
  }
}

/**
 * Resolve one badge's placement from THEME.card.badges: the named anchor
 * region plus padding (see BadgeSpot in theme.ts). Returns the top-left of
 * the badge circle plus its size, in card-local coordinates.
 */
function badgeSpot(
  w: number,
  h: number,
  style: 'framed' | 'fullArt',
  which: 'cost' | 'attack' | 'health' | 'equip'
): { x: number; y: number; size: number } {
  const b = THEME.card.badges;
  const spot = b[style][which] ?? { anchor: 'topLeft' as const };
  const size = w * (spot.size ?? b.size);
  const px = w * (spot.padX ?? 0);
  const py = w * (spot.padY ?? 0);
  const anchor = spot.anchor;

  let x: number;
  if (anchor.endsWith('Left')) x = -w / 2 + px;
  else if (anchor.endsWith('Right')) x = w / 2 - size - px;
  else x = -size / 2 + px; // topCenter / center / bottomCenter

  let y: number;
  if (anchor.startsWith('top')) y = -h / 2 + py;
  else if (anchor.startsWith('bottom')) y = h / 2 - size - py;
  else y = -size / 2 + py; // middleLeft / center / middleRight

  return { x, y, size };
}

/**
 * Scale an image to fill a w×h box without distortion, center-cropping the
 * overflow (CSS object-fit: cover). Cards are 3:4, so 3:4 art fits exactly
 * and any other aspect is cropped instead of stretched.
 */
function coverCrop(scene: Phaser.Scene, img: Phaser.GameObjects.Image, key: string, w: number, h: number): void {
  const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
  if (!src.width || !src.height) {
    img.setDisplaySize(w, h);
    return;
  }
  const scale = Math.max(w / src.width, h / src.height);
  img.setScale(scale);
  const cw = w / scale;
  const ch = h / scale;
  img.setCrop((src.width - cw) / 2, (src.height - ch) / 2, cw, ch);
}

function fitName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

/** Fallback emoji per pokemon-mode energy type (cards may carry their own). */
export const TYPE_EMOJI: Record<string, string> = {
  Blaze: '🔥', Chill: '🥶', Zap: '⚡', Solid: '👍', Mind: '🤯',
  Gross: '💩', Heart: '❤️', Chaos: '😂', Neutral: '👀', Any: '✳️',
};

/** A move's energy cost as emoji pips, e.g. "🔥🔥👀". */
export function costLine(cost: string[]): string {
  return cost.map((c) => TYPE_EMOJI[c] ?? '👀').join('');
}

function placeholderColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = THEME.card.artPalette;
  return palette[h % palette.length];
}
