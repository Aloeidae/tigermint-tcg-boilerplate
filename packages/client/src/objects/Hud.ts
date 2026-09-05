import Phaser from 'phaser';
import type { PlayerId, PlayerView, Phase } from '@tcg/shared';
import { THEME } from '../theme.js';

export interface HudCallbacks {
  onPhaseButton: () => void;
  onFaceClick: (player: PlayerId) => void;
  onConcede: () => void;
}

const PHASE_LABELS: Record<Phase, string> = {
  main1: 'Main Phase',
  combat: 'Combat',
  block: 'Blockers',
  main2: 'Second Main',
  setup: 'Setup',
};

const PHASE_BUTTON: Record<Phase, string> = {
  main1: 'To Combat ⚔',
  combat: 'End Combat',
  block: 'Waiting…',
  main2: 'End Turn ➤',
  setup: 'Waiting…',
};

/** Scene-supplied overrides for the contextual button and banner text. */
export interface HudOverrides {
  button?: { label: string; enabled: boolean };
  banner?: string;
  /** Two-tap concede: the armed label ("Really concede?"). */
  concedeLabel?: string;
}

/**
 * All the "numbers" chrome: both players' life / hand / deck counts, mana,
 * phase indicator, phase/end-turn button — plus the pulsing portrait glow
 * used when a player's face is a valid target.
 */
export class Hud {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly benchTop: number;
  private oppFaceCircle: Phaser.Geom.Circle | null = null;
  private myFaceCircle: Phaser.Geom.Circle | null = null;
  private highlights: Phaser.GameObjects.GameObject[] = [];

  /** Compact mode tightens everything for the portrait design space. */
  private readonly compact: boolean;

  constructor(scene: Phaser.Scene, width: number, height: number, benchTop: number, compact = false) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.benchTop = benchTop;
    this.compact = compact;
    this.container = scene.add.container(0, 0);
  }

  render(view: PlayerView, cb: HudCallbacks, overrides?: HudOverrides): void {
    this.container.removeAll(true);
    this.highlights = [];
    const T = THEME.hud;
    const g = this.scene.add.graphics();
    this.container.add(g);

    const myTurn = view.active === view.myId && !view.gameOver;
    const btnEnabled = overrides?.button ? overrides.button.enabled && !view.gameOver : myTurn;

    // One coordinate table per mode — portrait (compact) vs landscape.
    const L = this.compact
      ? {
          panelW: 414, panelH: 78, portraitX: 62, portraitR: 30, heartX: 126,
          chip1X: 198, chip2X: 276, manaX: 352, cy: 54, benchCy: this.benchTop + 52,
          // Portrait: the turn banner sits on the battle line between the
          // two army grids, where the vertical layout has natural space.
          bannerY: 610, bannerSize: 25, btnX: this.width - 112, btnW: 208, btnH: 62, btnFont: 24,
        }
      : {
          panelW: 470, panelH: 92, portraitX: 78, portraitR: 36, heartX: 150,
          chip1X: 232, chip2X: 330, manaX: 428, cy: 62, benchCy: this.benchTop + 62,
          bannerY: 96, bannerSize: 30, btnX: this.width - 190, btnW: 240, btnH: 64, btnFont: 27,
        };

    // ----- Opponent panel (top-left) -----
    const opp = view.opponent;
    g.fillStyle(T.panelTop, 0.82);
    g.fillRoundedRect(20, L.cy - L.panelH / 2 + 8, L.panelW, L.panelH, 14);
    this.oppFaceCircle = new Phaser.Geom.Circle(L.portraitX, L.cy, L.portraitR);
    this.portrait(g, L.portraitX, L.cy, L.portraitR, T.portraitOpp, opp.name);
    this.heart(g, L.heartX, L.cy, opp.life);
    this.statChip(g, L.chip1X, L.cy, '🂠', `${opp.handCount}`);
    this.statChip(g, L.chip2X, L.cy, '⿻', `${opp.deckCount}`);
    // Pokemon mode has no mana — that slot shows prize progress instead
    // (the heart doubles as "prizes left to give up").
    const pokemon = view.rules.gameMode === 'pokemon';
    if (pokemon) this.prizeText(L.manaX, L.cy, opp.prizesTaken ?? 0, view.rules.prizes);
    else this.manaText(L.manaX, L.cy, opp.mana, opp.maxMana);
    const oppZone = this.scene.add.zone(L.portraitX, L.cy, 84, 84).setOrigin(0.5).setInteractive();
    oppZone.on('pointerdown', () => cb.onFaceClick(opp.id));
    this.container.add(oppZone);

    // ----- My panel (on the bench, bottom-left) -----
    const me = view.you;
    const py = L.benchCy;
    g.fillStyle(T.panelBench, 0.65);
    g.fillRoundedRect(20, py - L.panelH / 2 + 8, L.panelW, L.panelH, 14);
    this.myFaceCircle = new Phaser.Geom.Circle(L.portraitX, py, L.portraitR);
    this.portrait(g, L.portraitX, py, L.portraitR, T.portraitMe, me.name);
    this.heart(g, L.heartX, py, me.life);
    this.statChip(g, L.chip1X, py, '⿻', `${me.deckCount}`);
    this.statChip(g, L.chip2X, py, '✝', `${me.graveyardCount}`);
    if (pokemon) this.prizeText(L.manaX, py, me.prizesTaken ?? 0, view.rules.prizes, true);
    else this.manaText(L.manaX, py, me.mana, me.maxMana, true);
    const myZone = this.scene.add.zone(L.portraitX, py, 84, 84).setOrigin(0.5).setInteractive();
    myZone.on('pointerdown', () => cb.onFaceClick(me.id));
    this.container.add(myZone);

    // ----- Turn / phase banner (below the opponent panel/hand) -----
    const bannerText =
      overrides?.banner ?? (myTurn ? `Your Turn — ${PHASE_LABELS[view.phase]}` : `Opponent's Turn`);
    const banner = this.scene.add
      .text(this.width / 2, L.bannerY, bannerText, {
        fontFamily: THEME.fonts.display,
        fontSize: `${L.bannerSize}px`,
        color: myTurn || overrides?.banner ? T.bannerActive : T.bannerIdle,
        stroke: T.bannerStroke,
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    this.container.add(banner);

    // ----- Phase button (right side of bench) -----
    const bx = L.btnX;
    const by = this.compact ? this.benchTop + 52 : this.benchTop + 60;
    const label = overrides?.button?.label ?? (myTurn ? PHASE_BUTTON[view.phase] : 'Waiting…');
    g.fillStyle(btnEnabled ? T.button : T.buttonDisabled, 1);
    g.fillRoundedRect(bx - L.btnW / 2, by - L.btnH / 2, L.btnW, L.btnH, 14);
    g.lineStyle(3, btnEnabled ? T.buttonEdge : 0x333333, 1);
    g.strokeRoundedRect(bx - L.btnW / 2, by - L.btnH / 2, L.btnW, L.btnH, 14);
    const btnText = this.scene.add
      .text(bx, by, label, {
        fontFamily: THEME.fonts.display,
        fontSize: `${L.btnFont}px`,
        color: btnEnabled ? T.buttonText : T.buttonDisabledText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(btnText);
    if (btnEnabled) {
      const btnZone = this.scene.add.zone(bx, by, L.btnW, L.btnH).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btnZone.on('pointerdown', cb.onPhaseButton);
      this.container.add(btnZone);
    }

    // ----- Concede (two taps: the second tap within 3s confirms) -----
    // Portrait: the bottom edge belongs to the hand, so concede sits at the
    // free right end of the battle line instead.
    const armed = overrides?.concedeLabel !== undefined;
    const concedeX = this.compact ? this.width - (armed ? 92 : 56) : this.width - (armed ? 90 : 70);
    const concedeY = this.compact ? 610 : this.height - 26;
    const concede = this.scene.add
      .text(concedeX, concedeY, overrides?.concedeLabel ?? 'Concede', {
        fontFamily: THEME.fonts.body,
        fontSize: armed ? '18px' : '17px',
        fontStyle: armed ? 'bold' : 'normal',
        color: armed ? THEME.fx.damageText : T.concede,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    concede.on('pointerdown', cb.onConcede);
    this.container.add(concede);
  }

  /** Which player's portrait is under this point (for face-targeting drops). */
  faceAt(x: number, y: number, view: PlayerView): PlayerId | null {
    if (this.oppFaceCircle && Phaser.Geom.Circle.Contains(this.oppFaceCircle, x, y)) return view.opponent.id;
    if (this.myFaceCircle && Phaser.Geom.Circle.Contains(this.myFaceCircle, x, y)) return view.you.id;
    return null;
  }

  portraitPos(player: PlayerId, view: PlayerView): { x: number; y: number } {
    const circle = player === view.myId ? this.myFaceCircle : this.oppFaceCircle;
    return { x: circle?.x ?? 78, y: circle?.y ?? 62 };
  }

  /** Pulsing ring around a portrait: "this face is a valid target". */
  highlightFace(player: PlayerId, view: PlayerView, color: number): void {
    const { x, y } = this.portraitPos(player, view);
    const ring = this.scene.add.circle(x, y, 46).setStrokeStyle(5, color, 0.95);
    const fill = this.scene.add.circle(x, y, 42, color, 0.18);
    this.scene.tweens.add({
      targets: [ring, fill],
      alpha: { from: 1, to: 0.5 },
      scale: { from: 1, to: 1.12 },
      yoyo: true,
      repeat: -1,
      duration: 480,
      ease: 'Sine.easeInOut',
    });
    this.container.add(fill);
    this.container.add(ring);
    this.highlights.push(ring, fill);
  }

  clearHighlights(): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = [];
  }

  private portrait(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, name: string): void {
    g.fillStyle(THEME.hud.portraitRing, 1);
    g.fillCircle(x, y, r + 4);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);
    const initial = this.scene.add
      .text(x, y, name.charAt(0).toUpperCase(), {
        fontFamily: THEME.fonts.display, fontSize: this.compact ? '27px' : '34px', color: THEME.card.bannerText, fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(initial);
  }

  private heart(g: Phaser.GameObjects.Graphics, x: number, y: number, life: number): void {
    g.fillStyle(THEME.hud.heart, 1);
    g.fillCircle(x - 9, y - 8, 13);
    g.fillCircle(x + 9, y - 8, 13);
    g.fillTriangle(x - 21, y - 3, x + 21, y - 3, x, y + 20);
    // Centered on the heart's visual mass (slightly above its geometric middle).
    const t = this.scene.add
      .text(x, y - 4, String(life), {
        fontFamily: THEME.fonts.body, fontSize: '19px', color: '#ffffff', fontStyle: 'bold',
        stroke: THEME.hud.heartStroke, strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.container.add(t);
  }

  private statChip(g: Phaser.GameObjects.Graphics, x: number, y: number, icon: string, value: string): void {
    const w = this.compact ? 70 : 76;
    const h = this.compact ? 40 : 44;
    g.fillStyle(THEME.hud.chip, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    const t = this.scene.add
      .text(x, y, `${icon} ${value}`, {
        fontFamily: THEME.fonts.body, fontSize: this.compact ? '19px' : '20px', color: THEME.hud.chipText,
      })
      .setOrigin(0.5);
    this.container.add(t);
  }

  /** Pokemon mode: prizes taken toward the win (the mana slot's tenant). */
  private prizeText(x: number, y: number, taken: number, total: number, big = false): void {
    const t = this.scene.add
      .text(x, y, `⭐ ${taken}/${total}`, {
        fontFamily: THEME.fonts.body,
        fontSize: this.compact ? (big ? '22px' : '19px') : big ? '24px' : '20px',
        color: THEME.hud.mana,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(t);
  }

  private manaText(x: number, y: number, mana: number, maxMana: number, big = false): void {
    const t = this.scene.add
      .text(x, y, `◆ ${mana}/${maxMana}`, {
        fontFamily: THEME.fonts.body,
        fontSize: this.compact ? (big ? '22px' : '19px') : big ? '24px' : '20px',
        color: THEME.hud.mana,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(t);
  }
}
