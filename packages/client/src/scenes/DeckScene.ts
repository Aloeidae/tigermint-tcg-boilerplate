import Phaser from 'phaser';
import { DECK_SIZE, type CardDef } from '@tcg/shared';
import { THEME } from '../theme.js';
import { PORTRAIT } from '../layout.js';
import { CardSprite } from '../objects/CardSprite.js';

/** One pickable card: the definition plus how many copies may join a deck
 *  (owned NFTs: one per token held; basic-deck cards: a fixed copy cap). */
export interface DeckPoolEntry {
  def: CardDef;
  max: number;
  /** True for wallet-owned (minted) cards — shown in their own section. */
  owned?: boolean;
  /** Mint-only card the player doesn't own yet: shown grayed, unpickable. */
  locked?: boolean;
}

interface DeckSceneData {
  pool: DeckPoolEntry[];
  /** Starting picks, keyed by card id (the saved deck, resolved by the menu). */
  counts: Record<string, number>;
  /** localStorage key the picks persist under (per wallet). */
  storageKey: string;
}

const CARD_W = 150;
const CARD_H = 200;
const COLS = PORTRAIT ? 4 : 10;
/** Extra vertical room in portrait so the stats strip clears the counter. */
const Y_OFF = PORTRAIT ? 46 : 0;

/** One labeled row of pickable cards with its own paging. */
interface Section {
  title: string;
  entries: DeckPoolEntry[];
  page: number;
  /** Vertical center of the card row. */
  rowY: number;
  headerY: number;
  emptyHint: string;
  container: Phaser.GameObjects.Container | null;
}

/**
 * The deck builder: pick which cards make up your deck from everything you
 * can play, split into two sections — OWNED CARDS (minted NFTs, one copy per
 * token held) and BASIC DECK (the standard pack/demo cards, a few copies
 * each). Picks persist per wallet in localStorage; any unfilled slots are
 * topped up from the basic deck at play time, so a partial deck is always
 * legal. Left-click adds a copy, right-click removes.
 */
export class DeckScene extends Phaser.Scene {
  private counts = new Map<string, number>();
  private storageKey = 'tm-deck-local';
  private sections: Section[] = [];
  private counterText!: Phaser.GameObjects.Text;
  private statsC: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Deck');
  }

  create(data: DeckSceneData): void {
    const pool = data.pool ?? [];
    this.counts = new Map(Object.entries(data.counts ?? {}));
    this.storageKey = data.storageKey ?? 'tm-deck-local';

    const { width, height } = this.scale;
    const T = THEME;
    this.input.mouse?.disableContextMenu();

    this.add.rectangle(width / 2, height / 2, width, height, T.menu.skyTop);
    if (this.textures.exists('menu-glow')) {
      this.add
        .image(width / 2, height * 1.12, 'menu-glow')
        .setDisplaySize(width * 2, height * 1.3)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.35);
    }

    this.add
      .text(width / 2, 52, 'DECK BUILDER', {
        fontFamily: T.fonts.display,
        fontSize: PORTRAIT ? '42px' : '50px',
        color: T.menu.title,
        stroke: T.hud.bannerStroke,
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 100, PORTRAIT
        ? 'Tap a card to add copies — one past the max clears it · basic deck fills unpicked slots'
        : 'Left-click adds a copy · right-click removes · the basic deck fills any unpicked slots', {
        fontFamily: T.fonts.body,
        fontSize: PORTRAIT ? '14px' : '18px',
        color: T.menu.subtitle,
        align: 'center',
        wordWrap: { width: width - 80 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    this.counterText = this.add
      .text(width / 2, 142, '', {
        fontFamily: T.fonts.mono,
        fontSize: '24px',
        color: T.hud.chipText,
      })
      .setOrigin(0.5);

    this.sections = [
      {
        title: 'OWNED CARDS',
        entries: pool.filter((p) => p.owned),
        page: 0,
        headerY: 196 + Y_OFF,
        rowY: 330 + Y_OFF,
        emptyHint: 'No minted cards yet — connect your wallet and pull to grow your collection.',
        container: null,
      },
      {
        title: 'BASIC DECK',
        entries: pool.filter((p) => !p.owned),
        page: 0,
        headerY: 500 + Y_OFF,
        rowY: 634 + Y_OFF,
        emptyHint: 'No basic deck configured.',
        container: null,
      },
    ];

    for (const s of this.sections) this.renderSection(s);
    this.updateCounter();

    // Footer buttons.
    const fy = height - 92;
    this.makeButton(width / 2 - 240, fy, 'SAVE DECK', true, () => this.saveAndExit());
    this.makeButton(width / 2 + 30, fy, 'RESET', false, () => this.resetAndExit());
    this.makeButton(width / 2 + 240, fy, 'BACK', false, () => this.scene.start('Menu'));
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  private updateCounter(): void {
    const total = this.total();
    this.counterText.setText(`${total} / ${DECK_SIZE}${total < DECK_SIZE ? '  (basic deck fills the rest)' : ''}`);
    this.counterText.setColor(total === DECK_SIZE ? THEME.menu.title : THEME.hud.chipText);
    this.renderStats();
  }

  /** What the final 30 will actually be: picks + basic-deck fill preview. */
  private previewDeck(): CardDef[] {
    const deck: CardDef[] = [];
    for (const s of this.sections) {
      for (const e of s.entries) {
        const n = this.counts.get(e.def.id) ?? 0;
        for (let i = 0; i < n; i++) deck.push(e.def);
      }
    }
    const basics = this.sections[1]?.entries.filter((e) => !e.locked) ?? [];
    if (basics.length > 0) {
      for (let i = 0; deck.length < DECK_SIZE; i++) deck.push(basics[i % basics.length].def);
    }
    return deck;
  }

  /** Live stats for the previewed deck: mana curve, type counts, rarity split. */
  private renderStats(): void {
    const { width } = this.scale;
    const T = THEME;
    this.statsC?.destroy();
    const c = this.add.container(0, 0);
    this.statsC = c;
    const deck = this.previewDeck();
    if (deck.length === 0) return;
    const gapX = 22;
    const gridW = COLS * CARD_W + (COLS - 1) * gapX;
    const x0 = (width - gridW) / 2;

    // Mana curve (left edge): one bar per cost 1..7+.
    const buckets = new Array(8).fill(0) as number[];
    for (const d of deck) buckets[Math.min(8, Math.max(1, d.cost)) - 1] += 1;
    const maxB = Math.max(...buckets, 1);
    const bw = 13;
    const bs = 5;
    const baseY = 158;
    const maxH = 32;
    c.add(
      this.add.text(x0, 116 + Y_OFF, 'CURVE', { fontFamily: T.fonts.mono, fontSize: '11px', color: T.menu.subtitle }).setOrigin(0, 0.5)
    );
    const g = this.add.graphics();
    buckets.forEach((n, i) => {
      const bh = Math.max(2, (n / maxB) * maxH);
      g.fillStyle(n > 0 ? T.fx.overlayAccent : T.hud.chip, 1);
      g.fillRect(x0 + i * (bw + bs), baseY + Y_OFF - bh, bw, bh);
    });
    c.add(g);
    buckets.forEach((_n, i) => {
      c.add(
        this.add.text(x0 + i * (bw + bs) + bw / 2, 167 + Y_OFF, `${i + 1}${i === 7 ? '+' : ''}`, {
          fontFamily: T.fonts.mono, fontSize: '10px', color: T.menu.subtitle,
        }).setOrigin(0.5)
      );
    });

    // Type counts + rarity split (right edge).
    const types: Record<string, number> = { creature: 0, equipment: 0, spell: 0 };
    const rarities = new Map<string, number>();
    for (const d of deck) {
      types[d.type] = (types[d.type] ?? 0) + 1;
      const tier = (d.rarity ?? 'COMMON').toUpperCase();
      rarities.set(tier, (rarities.get(tier) ?? 0) + 1);
    }
    c.add(
      this.add.text(x0 + gridW, 124 + Y_OFF, `🐾 ${types.creature}   ⚔ ${types.equipment}   ✨ ${types.spell}`, {
        fontFamily: T.fonts.mono, fontSize: '15px', color: T.hud.chipText,
      }).setOrigin(1, 0.5)
    );
    let rx = x0 + gridW;
    for (const tier of ['LEGENDARY', 'EPIC', 'RARE', 'COMMON']) {
      const n = rarities.get(tier) ?? 0;
      if (n === 0) continue;
      const t = this.add
        .text(rx, 154 + Y_OFF, String(n), { fontFamily: T.fonts.mono, fontSize: '13px', color: T.menu.subtitle })
        .setOrigin(1, 0.5);
      c.add(t);
      const dot = this.add.graphics();
      dot.fillStyle(T.card.rarityGlow[tier] ?? T.hud.chip, 1);
      dot.fillCircle(rx - t.width - 9, 154 + Y_OFF, 5);
      c.add(dot);
      rx -= t.width + 26;
    }
  }

  private renderSection(s: Section): void {
    const { width } = this.scale;
    const T = THEME;
    s.container?.destroy();
    const c = this.add.container(0, 0);
    s.container = c;

    const gapX = 22;
    const gridW = COLS * CARD_W + (COLS - 1) * gapX;
    const x0 = (width - gridW) / 2;

    // Header: accent bar + caps label (+ page indicator when paging).
    const pages = Math.max(1, Math.ceil(s.entries.length / COLS));
    const bar = this.add.graphics();
    bar.fillStyle(T.fx.overlayAccent, 1);
    bar.fillRect(x0, s.headerY - 13, 4, 26);
    c.add(bar);
    c.add(
      this.add.text(x0 + 16, s.headerY, s.title, {
        fontFamily: T.fonts.display,
        fontSize: '25px',
        color: T.hud.chipText,
      }).setOrigin(0, 0.5)
    );
    c.add(
      this.add.text(x0 + gridW, s.headerY, pages > 1 ? `${s.page + 1} / ${pages}` : '', {
        fontFamily: T.fonts.mono,
        fontSize: '17px',
        color: T.menu.subtitle,
      }).setOrigin(1, 0.5)
    );

    if (s.entries.length === 0) {
      c.add(
        this.add.text(width / 2, s.rowY, s.emptyHint, {
          fontFamily: T.fonts.body,
          fontSize: '19px',
          color: T.menu.subtitle,
        }).setOrigin(0.5).setAlpha(0.75)
      );
      return;
    }

    if (pages > 1) {
      const inset = PORTRAIT ? 38 : 58;
      this.makeArrow(c, x0 - inset, s.rowY, '‹', () => this.turnPage(s, -1, pages));
      this.makeArrow(c, x0 + gridW + inset, s.rowY, '›', () => this.turnPage(s, 1, pages));
    }

    const slice = s.entries.slice(s.page * COLS, (s.page + 1) * COLS);
    slice.forEach((entry, i) => {
      const x = x0 + CARD_W / 2 + i * (CARD_W + gapX);
      const picked = this.counts.get(entry.def.id) ?? 0;

      const tile = this.add.container(x, s.rowY);
      // Rarity halo: tint from the mint's rarity tier (see THEME.card.rarityGlow).
      const rarityColor = T.card.rarityGlow[(entry.def.rarity ?? '').toUpperCase()];
      const sprite = new CardSprite(this, 0, 0, CARD_W, CARD_H, entry.def, {
        glow: rarityColor !== undefined && !entry.locked,
        glowColor: rarityColor,
        dim: entry.locked,
      });
      sprite.setAlpha(entry.locked ? 0.45 : picked > 0 ? 1 : 0.82);
      tile.add(sprite);

      // Copy chip under the card: picked / allowed (or the mint lock).
      const chip = this.add.graphics();
      chip.fillStyle(picked > 0 ? T.hud.button : T.hud.chip, 1);
      chip.fillRoundedRect(entry.locked ? -52 : -34, CARD_H / 2 + 8, entry.locked ? 104 : 68, 27, 8);
      const chipText = this.add
        .text(0, CARD_H / 2 + 21.5, entry.locked ? '🔒 mint to use' : `${picked} / ${entry.max}`, {
          fontFamily: T.fonts.mono,
          fontSize: entry.locked ? '13px' : '15px',
          color: picked > 0 ? T.hud.buttonText : T.hud.chipText,
        })
        .setOrigin(0.5);
      tile.add([chip, chipText]);

      const zone = this.add
        .zone(0, 10, CARD_W + gapX, CARD_H + 56)
        .setOrigin(0.5)
        .setInteractive();
      zone.on('pointerover', () => tile.setScale(entry.locked ? 1.02 : 1.05));
      zone.on('pointerout', () => tile.setScale(1));
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (entry.locked) {
          // Locked = pull it first. A little shake instead of a pick.
          this.tweens.add({ targets: tile, x: { from: x - 4, to: x }, duration: 120, ease: 'Sine.easeOut' });
          return;
        }
        this.change(entry, p.rightButtonDown() ? -1 : 1, s);
      });
      tile.add(zone);
      c.add(tile);
    });
  }

  private turnPage(s: Section, dir: number, pages: number): void {
    s.page = (s.page + dir + pages) % pages;
    this.renderSection(s);
  }

  private change(entry: DeckPoolEntry, dir: 1 | -1, s: Section): void {
    const id = entry.def.id;
    const now = this.counts.get(id) ?? 0;
    if (dir > 0 && (now >= entry.max || this.total() >= DECK_SIZE)) {
      // Touch-friendly: adding past the max (or into a full deck) clears the
      // pick instead — tap to cycle 0 → max → 0. Nothing picked = just a nudge.
      if (now > 0) {
        this.counts.delete(id);
        this.renderSection(s);
        this.updateCounter();
        return;
      }
      this.tweens.add({ targets: this.counterText, scale: { from: 1.25, to: 1 }, duration: 180 });
      return;
    }
    const next = now + dir;
    if (next <= 0) this.counts.delete(id);
    else this.counts.set(id, next);
    this.renderSection(s);
    this.updateCounter();
  }

  /** Persist the picks (expanded to one id per copy) and return to the menu. */
  private saveAndExit(): void {
    const ids: string[] = [];
    for (const s of this.sections) {
      for (const entry of s.entries) {
        const n = this.counts.get(entry.def.id) ?? 0;
        for (let i = 0; i < n; i++) ids.push(entry.def.id);
      }
    }
    try {
      if (ids.length === 0) localStorage.removeItem(this.storageKey);
      else localStorage.setItem(this.storageKey, JSON.stringify(ids));
    } catch {
      // storage unavailable — the deck still applies for this session via Menu rebuild
    }
    this.scene.start('Menu');
  }

  private resetAndExit(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // fine
    }
    this.scene.start('Menu');
  }

  private makeButton(x: number, y: number, label: string, primary: boolean, onClick: () => void): void {
    const T = THEME;
    const w = 190;
    const h = 54;
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(primary ? T.hud.button : T.hud.chip, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.lineStyle(2, primary ? T.hud.buttonEdge : T.board.benchEdge, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    const t = this.add
      .text(0, 0, label, {
        fontFamily: T.fonts.display,
        fontSize: '22px',
        color: primary ? T.hud.buttonText : T.hud.chipText,
      })
      .setOrigin(0.5);
    c.add([g, t]);
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => c.setScale(1.04));
    c.on('pointerout', () => c.setScale(1));
    c.on('pointerdown', onClick);
  }

  private makeArrow(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    label: string,
    onClick: () => void
  ): void {
    const T = THEME;
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(T.hud.chip, 1);
    g.fillCircle(0, 0, 27);
    const t = this.add
      .text(0, -3, label, { fontFamily: T.fonts.display, fontSize: '34px', color: T.menu.title })
      .setOrigin(0.5);
    c.add([g, t]);
    c.setSize(54, 54).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => c.setScale(1.1));
    c.on('pointerout', () => c.setScale(1));
    c.on('pointerdown', onClick);
    parent.add(c);
  }
}
