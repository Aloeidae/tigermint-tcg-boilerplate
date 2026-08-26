import Phaser from 'phaser';
import {
  creatureHasFlag,
  effectTargetSpec,
  type CardDef,
  type CardInstance,
  type Command,
  type CreatureOnBoard,
  type EffectTarget,
  type GameEvent,
  type PlayerView,
  type TargetSpec,
} from '@tcg/shared';
import type { Connection } from '../net/Connection.js';
import { CardSprite } from '../objects/CardSprite.js';
import { RowLayout } from '../objects/RowLayout.js';
import { HandLayout } from '../objects/HandLayout.js';
import { Hud } from '../objects/Hud.js';
import { TargetArrow } from '../objects/TargetArrow.js';
import { ensureArtTextures } from '../artLoader.js';
import { THEME } from '../theme.js';
import * as Fx from '../objects/Fx.js';
import { playSound } from '../audio.js';

// All positions live in the orientation-aware design space — see layout.ts
// (landscape 1920×1080 on desktop, portrait 810×1440 on phones/Mini Apps).
import {
  BENCH_TOP,
  ENEMY_TERRITORY_Y,
  H,
  HAND_CARD,
  HAND_Y,
  LOG,
  MY_DECK_POS,
  MY_GRAVE_POS,
  MY_ROW_Y,
  OPP_BACK,
  OPP_BURN_POS,
  OPP_DECK_POS,
  OPP_HAND_POS,
  OPP_ROW_Y,
  PORTRAIT,
  ROW_CARD,
  W,
} from '../layout.js';

/**
 * The battle screen. Purely presentational: it renders the redacted view it
 * gets from the Connection and turns user input into Commands. All rules live
 * in @tcg/shared — including which targets are legal, which this scene merely
 * mirrors as contextual highlights.
 */
export class GameScene extends Phaser.Scene {
  private conn!: Connection;
  private view!: PlayerView;

  private oppRow!: RowLayout;
  private myRow!: RowLayout;
  private hand!: HandLayout;
  private hud!: Hud;
  private arrow!: TargetArrow;
  private oppHand!: Phaser.GameObjects.Container;
  private logText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];
  private selectedAttacker: string | null = null;
  private inspectLayer: Phaser.GameObjects.GameObject[] = [];
  private ended = false;
  private mulliganDecided = false;
  private mulliganUi: Phaser.GameObjects.Container | null = null;
  /** Blockers-mode defense: my in-progress block assignments. */
  private pendingBlocks = new Map<string, string>();
  private selectedBlocker: string | null = null;
  private blockLines: Phaser.GameObjects.Graphics | null = null;
  /** Two-tap concede confirmation. */
  private concedeArmed = false;
  private concedeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super('Game');
  }

  init(data: { conn: Connection }): void {
    this.conn = data.conn;
    this.logLines = [];
    this.selectedAttacker = null;
    this.ended = false;
  }

  create(): void {
    this.view = this.conn.lastView!;
    this.paintBackground();

    // A few pixels of movement distinguish a drag from a click.
    this.input.dragDistanceThreshold = 8;

    // Creation order fixes the z-order: rows < log < hud < hand < arrow.
    this.oppRow = new RowLayout(this, W / 2, OPP_ROW_Y, this.view.rules.maxRow, ROW_CARD.w, ROW_CARD.h, ROW_CARD.spacing, ROW_CARD.cols, ROW_CARD.rowGap);
    this.myRow = new RowLayout(this, W / 2, MY_ROW_Y, this.view.rules.maxRow, ROW_CARD.w, ROW_CARD.h, ROW_CARD.spacing, ROW_CARD.cols, ROW_CARD.rowGap);
    this.oppHand = this.add.container(0, 0);
    this.logText = this.add.text(LOG.x, LOG.y, '', {
      fontFamily: THEME.fonts.mono, fontSize: `${LOG.fontSize}px`, color: THEME.hud.log,
      stroke: THEME.hud.bannerStroke, strokeThickness: 3, lineSpacing: 6,
    });
    this.hud = new Hud(this, W, H, BENCH_TOP, PORTRAIT);
    this.hand = new HandLayout(this, W / 2, HAND_Y, HAND_CARD);
    this.arrow = new TargetArrow(this);

    this.conn.onUpdate = (view, events) => {
      this.playEventEffects(events); // uses the sprites of the outgoing render
      this.view = view;
      this.pushLog(events);
      this.renderAll();
    };
    this.conn.onError = (msg) => this.toast(msg);
    this.conn.onClose = (msg) => this.showEndOverlay('Match ended', msg);
    this.conn.onNotice = (msg) => this.toast(msg);

    // Replay playback: SPACE pauses/resumes; a chip marks spectator views.
    const replayConn = this.conn as { togglePause?: () => boolean };
    if (typeof replayConn.togglePause === 'function') {
      this.input.keyboard?.on('keydown-SPACE', () => {
        const paused = replayConn.togglePause!();
        this.toast(paused ? 'Replay paused (SPACE to resume)' : 'Replay resumed');
      });
    }
    if (this.conn.lastView?.spectator) {
      this.add
        .text(W / 2, BENCH_TOP + 24, typeof replayConn.togglePause === 'function' ? '▶ REPLAY — SPACE pauses' : '👁 SPECTATING', {
          fontFamily: THEME.fonts.display,
          fontSize: '22px',
          color: THEME.hud.bannerActive,
        })
        .setOrigin(0.5)
        .setDepth(500)
        .setAlpha(0.9);
    }

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.arrow.update(p.worldX, p.worldY));
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length === 0) this.deselect();
      }
    );
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.conn.dispose());

    this.renderAll();
  }

  // -------------------------------------------------------------- rendering

  private paintBackground(): void {
    const T = THEME.board;
    // A 'bg-board' texture (preload it in BootScene) replaces the procedural
    // battlefield; the wooden bench is still drawn under the hand.
    if (this.textures.exists('bg-board')) {
      this.add.image(W / 2, H / 2, 'bg-board').setDisplaySize(W, H);
    } else {
      const g = this.add.graphics();
      g.fillGradientStyle(T.skyTop, T.skyTop, T.skyBottom, T.skyBottom, 1);
      g.fillRect(0, 0, W, BENCH_TOP);
      g.fillStyle(T.field, 1);
      g.fillEllipse(W / 2, BENCH_TOP * 0.62, W * 1.1, BENCH_TOP * 0.95);
      for (let i = 0; i < 70; i++) {
        g.fillStyle(T.snow, 0.5);
        g.fillCircle(Math.random() * W, Math.random() * BENCH_TOP, 1 + Math.random() * 2);
      }
    }
    const bench = this.add.graphics();
    bench.fillStyle(T.bench, 1);
    bench.fillRect(0, BENCH_TOP, W, H - BENCH_TOP);
    bench.fillStyle(T.benchEdge, 1);
    bench.fillRect(0, BENCH_TOP, W, 14);
    bench.fillStyle(T.benchAccent, 0.6);
    bench.fillRect(0, BENCH_TOP, W, 3);
    bench.fillStyle(T.benchSlat, 1);
    for (let x = 0; x < W; x += 240) bench.fillRect(x, BENCH_TOP + 14, 4, H - BENCH_TOP);
  }

  /** The opponent's hand, shown as a fan of card backs peeking from the top. */
  private renderOppHand(count: number): void {
    for (const child of this.oppHand.list) this.tweens.killTweensOf(child);
    this.oppHand.removeAll(true);
    const shown = Math.min(count, 10);
    if (shown === 0) return;
    const backDef = { id: 'opp-back', name: '', type: 'creature' as const, cost: 0 };
    const spacing = PORTRAIT ? 34 : 46;
    const startX = OPP_HAND_POS.x - ((shown - 1) * spacing) / 2;
    for (let i = 0; i < shown; i++) {
      const t = shown > 1 ? i / (shown - 1) - 0.5 : 0;
      const back = new CardSprite(
        this, startX + i * spacing, OPP_HAND_POS.y + Math.abs(t) * -14, OPP_BACK.w, OPP_BACK.h, backDef, { faceDown: true }
      );
      back.setAngle(t * -12); // gentle fan hanging from the top edge
      this.oppHand.add(back);
    }
  }

  private renderAll(): void {
    const view = this.view;
    const myTurn = view.active === view.myId && !view.gameOver && !view.spectator;
    const mainPhase = view.phase === 'main1' || view.phase === 'main2';
    const combat = view.phase === 'combat';
    const blockers = view.rules.combatStyle === 'blockers';
    // Block step: the DEFENDER (non-active player) is the one acting.
    const amDefending = view.phase === 'block' && view.active !== view.myId && !view.gameOver && !view.spectator;
    if (view.phase !== 'block') {
      this.pendingBlocks.clear();
      this.selectedBlocker = null;
    }

    if (this.selectedAttacker && !this.findMyCreature(this.selectedAttacker)) this.deselect();

    // Attackers that may still act glow; spent ones dim.
    const glowIds = new Set<string>();
    const dimIds = new Set<string>();
    for (const c of view.you.row) {
      if (!c) continue;
      const canAct = c.ready && c.attacksUsed < view.rules.attacksPerTurn && c.attack > 0;
      if (myTurn && combat && canAct) glowIds.add(c.instanceId);
      if (myTurn && combat && !canAct) dimIds.add(c.instanceId);
      // Defending: every creature can block.
      if (amDefending) glowIds.add(c.instanceId);
    }

    this.oppRow.render(view.opponent.row, {
      onCreatureClick: (id) => this.onEnemyCreatureClick(id),
    });
    this.myRow.render(view.you.row, {
      glowIds,
      dimIds,
      // Blockers mode declares by tapping; only targeted mode drags attacks.
      draggableIds: blockers ? new Set() : glowIds,
      onCreatureClick: (id) => this.onMyCreatureClick(id),
      onCreatureDragStart: (id, sprite) => {
        this.selectedAttacker = id;
        this.arrow.show(sprite.x, sprite.y - 40);
        this.showAttackTargets();
      },
      onCreatureDrop: (id, pointer) => this.onAttackDrop(id, pointer),
    });
    this.hand.render(view.you.hand, {
      playableIds: myTurn && mainPhase ? this.computePlayable() : new Set(),
      deckOrigin: MY_DECK_POS,
      onDrop: (card, pointer) => this.onHandDrop(card, pointer),
      onDragStart: (card) => {
        this.deselect();
        this.showCardTargets(card.def);
      },
      onInspect: (card) => this.inspect(card.def),
    });
    this.renderOppHand(view.opponent.handCount);
    this.hud.render(view, {
      onPhaseButton: () => this.onHudButton(),
      onFaceClick: (player) => this.onFaceClick(player),
      onConcede: () => this.onConcede(),
    }, this.hudOverrides(myTurn, amDefending));
    this.logText.setText(this.logLines.join('\n'));

    // Blockers-mode combat glue: highlight declared attackers, and while
    // defending, show block assignments as lines from blocker to attacker.
    this.blockLines?.destroy();
    this.blockLines = null;
    const attackerSet = new Set(view.attackers);
    if (attackerSet.size > 0) {
      (view.active === view.myId ? this.myRow : this.oppRow).highlight(attackerSet, THEME.fx.glowEnemy);
    }
    if (amDefending) this.renderBlockAssignments();

    if (view.gameOver && !this.ended) {
      const won = view.winner === view.myId;
      this.showEndOverlay(won ? 'Victory!' : 'Defeat', won ? 'You win the match!' : 'Better luck next time.');
    }

    // Opening-hand mulligan offer (rules.mulligan, first round, once).
    if (
      view.rules.mulligan && !view.you.mulliganUsed && view.turn <= 2 &&
      !view.gameOver && !this.mulliganDecided && !this.mulliganUi
    ) {
      this.showMulliganPrompt();
    } else if (this.mulliganUi && (view.you.mulliganUsed || view.turn > 2)) {
      this.mulliganUi.destroy();
      this.mulliganUi = null;
    }

    // Lazily pull in any NFT art we haven't loaded yet (e.g. opponent cards in PvP).
    const defs: CardDef[] = [
      ...view.you.hand.map((c) => c.def),
      ...view.you.row.filter((c): c is CreatureOnBoard => !!c).map((c) => c.def),
      ...view.opponent.row.filter((c): c is CreatureOnBoard => !!c).map((c) => c.def),
    ];
    void ensureArtTextures(this, defs).then((loaded) => {
      if (loaded && !this.ended) this.renderAll();
    });
  }

  private computePlayable(): Set<string> {
    const view = this.view;
    const ids = new Set<string>();
    const myCreatures = view.you.row.some((c) => c !== null);
    const oppCreatures = view.opponent.row.some((c) => c !== null);
    const freeSlot = view.you.row.some((c) => c === null);
    for (const card of view.you.hand) {
      const def = card.def;
      if (def.cost > view.you.mana) continue;
      if (def.type === 'creature' && !freeSlot) continue;
      if (def.type === 'equipment' && !myCreatures) continue;
      if (def.type === 'spell') {
        const spec = effectTargetSpec(def.effect);
        if (spec === 'friendly-creature' && !myCreatures) continue;
        if (spec === 'enemy-creature' && !oppCreatures) continue;
        if (spec === 'any-creature' && !myCreatures && !oppCreatures) continue;
      }
      ids.add(card.instanceId);
    }
    return ids;
  }

  // -------------------------------------------------- contextual target glow

  /** Enemy creatures with the Guard skill — they soak attacks first. */
  private enemyGuards(): CreatureOnBoard[] {
    return this.view.opponent.row.filter(
      (c): c is CreatureOnBoard => !!c && creatureHasFlag(c, 'guards')
    );
  }

  /** May the enemy's face be attacked right now (guard skill + guard rule)? */
  private canAttackFace(): boolean {
    if (this.enemyGuards().length > 0) return false;
    return (
      !this.view.rules.mustAttackCreaturesFirst ||
      !this.view.opponent.row.some((c) => c !== null)
    );
  }

  /** Which enemy creatures may legally be attacked (guards restrict this). */
  private legalAttackTargetIds(): Set<string> {
    const guards = this.enemyGuards();
    if (guards.length > 0) return new Set(guards.map((g) => g.instanceId));
    return this.ids(this.view.opponent.row);
  }

  private ids(row: (CreatureOnBoard | null)[]): Set<string> {
    return new Set(row.filter((c): c is CreatureOnBoard => c !== null).map((c) => c.instanceId));
  }

  /** Glow every legal target for a card being dragged from the hand. */
  private showCardTargets(def: CardDef): void {
    this.clearTargets();
    const view = this.view;
    const friendly = THEME.fx.glowFriendly;
    const enemy = THEME.fx.glowEnemy;

    if (def.type === 'creature') return; // row slots are already marked
    if (def.type === 'equipment') {
      this.myRow.highlight(this.ids(view.you.row), friendly);
      return;
    }
    const spec: TargetSpec = effectTargetSpec(def.effect);
    switch (spec) {
      case 'friendly-creature':
        this.myRow.highlight(this.ids(view.you.row), friendly);
        break;
      case 'enemy-creature':
        this.oppRow.highlight(this.ids(view.opponent.row), enemy);
        break;
      case 'any-creature':
        this.myRow.highlight(this.ids(view.you.row), friendly);
        this.oppRow.highlight(this.ids(view.opponent.row), enemy);
        break;
      case 'friendly':
        this.myRow.highlight(this.ids(view.you.row), friendly);
        this.hud.highlightFace(view.myId, view, friendly);
        break;
      case 'any':
        this.myRow.highlight(this.ids(view.you.row), friendly);
        this.oppRow.highlight(this.ids(view.opponent.row), enemy);
        this.hud.highlightFace(view.opponent.id, view, enemy);
        this.hud.highlightFace(view.myId, view, friendly);
        break;
      case 'none':
        break;
    }
  }

  /** Glow every LEGAL attack target for the selected attacker. */
  private showAttackTargets(): void {
    this.clearTargets();
    const view = this.view;
    this.oppRow.highlight(this.legalAttackTargetIds(), THEME.fx.glowEnemy);
    if (this.canAttackFace()) {
      this.hud.highlightFace(view.opponent.id, view, THEME.fx.glowEnemy);
    }
  }

  private clearTargets(): void {
    this.myRow.clearHighlights();
    this.oppRow.clearHighlights();
    this.hud.clearHighlights();
  }

  // ------------------------------------------------------------------ input

  private onHandDrop(card: CardInstance, pointer: Phaser.Input.Pointer): void {
    this.clearTargets();
    const { worldX: x, worldY: y } = pointer;
    if (y > BENCH_TOP) return; // dropped back onto the bench: cancel
    const cmd = this.resolveDrop(card, x, y);
    if (cmd) this.send(cmd);
  }

  private resolveDrop(card: CardInstance, x: number, y: number): Command | null {
    const view = this.view;
    const me = view.myId;
    const def = card.def;

    if (def.type === 'creature') {
      const slot = this.myRow.slotAt(x, y);
      const free = view.you.row.findIndex((c) => c === null);
      if (free === -1) return null;
      const chosen = slot !== null && view.you.row[slot] === null ? slot : free;
      return { type: 'playCard', player: me, instanceId: card.instanceId, slot: chosen };
    }

    if (def.type === 'equipment') {
      const target = this.myRow.creatureAt(x, y, view.you.row);
      if (!target) {
        this.toast('Drop equipment on one of your creatures');
        return null;
      }
      return { type: 'playCard', player: me, instanceId: card.instanceId, target: { kind: 'creature', instanceId: target } };
    }

    // Spell: resolve the drop point against what the effect can target.
    // Dropping into the enemy backfield (no creature under the pointer) counts
    // as targeting the enemy player, same as dropping on their portrait.
    const spec = effectTargetSpec(def.effect);
    const mine = this.myRow.creatureAt(x, y, view.you.row);
    const theirs = this.oppRow.creatureAt(x, y, view.opponent.row);
    const face = this.hud.faceAt(x, y, view);
    const enemyBackfield = theirs === null && y < ENEMY_TERRITORY_Y;
    const myTerritory = mine === null && y >= ENEMY_TERRITORY_Y;

    switch (spec) {
      case 'none':
        return { type: 'playCard', player: me, instanceId: card.instanceId, target: { kind: 'none' } };
      case 'any':
        if (theirs) return this.spellAt(card, { kind: 'creature', instanceId: theirs });
        if (mine) return this.spellAt(card, { kind: 'creature', instanceId: mine });
        if (face !== null) return this.spellAt(card, { kind: 'face', player: face });
        if (enemyBackfield) return this.spellAt(card, { kind: 'face', player: view.opponent.id });
        break;
      case 'friendly':
        if (mine) return this.spellAt(card, { kind: 'creature', instanceId: mine });
        if (face === me || myTerritory) return this.spellAt(card, { kind: 'face', player: me });
        break;
      case 'friendly-creature':
        if (mine) return this.spellAt(card, { kind: 'creature', instanceId: mine });
        break;
      case 'enemy-creature':
        if (theirs) return this.spellAt(card, { kind: 'creature', instanceId: theirs });
        break;
      case 'any-creature': {
        const id = theirs ?? mine;
        if (id) return this.spellAt(card, { kind: 'creature', instanceId: id });
        break;
      }
    }
    this.toast('Drop the spell on a valid target');
    return null;
  }

  private spellAt(card: CardInstance, target: EffectTarget): Command {
    return { type: 'playCard', player: this.view.myId, instanceId: card.instanceId, target };
  }

  /** The one HUD button, contextual per phase (see hudOverrides). */
  private onHudButton(): void {
    const view = this.view;
    if (view.phase === 'block' && view.active !== view.myId) {
      const blocks = [...this.pendingBlocks].map(([blocker, attacker]) => ({ blocker, attacker }));
      this.send({ type: 'declareBlockers', player: view.myId, blocks });
      return;
    }
    this.send({ type: 'advancePhase', player: view.myId });
  }

  /** A first tap on Concede arms it; a second within 3 seconds confirms. */
  private onConcede(): void {
    if (!this.concedeArmed) {
      this.concedeArmed = true;
      this.toast('Tap again to concede');
      this.renderAll();
      this.concedeTimer = setTimeout(() => {
        this.concedeArmed = false;
        this.concedeTimer = null;
        if (!this.ended) this.renderAll();
      }, 3000);
      return;
    }
    if (this.concedeTimer) clearTimeout(this.concedeTimer);
    this.concedeArmed = false;
    this.send({ type: 'concede', player: this.view.myId });
  }

  /** Contextual HUD button label/state + banner for blockers-style combat. */
  private hudOverrides(myTurn: boolean, amDefending: boolean): import('../objects/Hud.js').HudOverrides | undefined {
    const view = this.view;
    const overrides: import('../objects/Hud.js').HudOverrides = {};
    if (this.concedeArmed) overrides.concedeLabel = 'Really concede?';

    if (view.rules.combatStyle === 'blockers') {
      if (amDefending) {
        const n = view.attackers.length;
        overrides.button = { label: this.pendingBlocks.size > 0 ? `Block ×${this.pendingBlocks.size} 🛡` : 'No Blocks', enabled: true };
        overrides.banner = `Declare blockers — ${n} incoming attack${n === 1 ? '' : 's'}!`;
      } else if (view.phase === 'block') {
        overrides.button = { label: 'Waiting…', enabled: false };
        overrides.banner = 'Opponent is declaring blockers…';
      } else if (myTurn && view.phase === 'combat') {
        const n = view.attackers.length;
        overrides.button = { label: n > 0 ? `Attack ×${n} ⚔` : 'Skip Combat', enabled: true };
      }
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  /** Defender view: pulse pickable blockers, draw lines for assigned blocks. */
  private renderBlockAssignments(): void {
    const g = this.add.graphics().setDepth(700);
    this.blockLines = g;
    // Selected blocker pulses; assigned blockers glow friendly.
    if (this.selectedBlocker) {
      this.myRow.highlight(new Set([this.selectedBlocker]), THEME.fx.glowPlayable);
    }
    if (this.pendingBlocks.size > 0) {
      this.myRow.highlight(new Set(this.pendingBlocks.keys()), THEME.fx.glowFriendly);
    }
    for (const [blockerId, attackerId] of this.pendingBlocks) {
      const from = this.myRow.spriteFor(blockerId);
      const to = this.oppRow.spriteFor(attackerId);
      if (!from || !to) continue;
      g.lineStyle(5, THEME.fx.glowFriendly, 0.85);
      g.lineBetween(from.x, from.y - 20, to.x, to.y + 20);
      g.fillStyle(THEME.fx.glowFriendly, 0.95);
      g.fillCircle(to.x, to.y + 20, 9);
    }
  }

  private onMyCreatureClick(id: string): void {
    const view = this.view;
    const creature = this.findMyCreature(id);
    if (!creature) return;
    const myTurn = view.active === view.myId && !view.gameOver && !view.spectator;

    // Blockers-mode defense: tap a creature to pick it as the next blocker
    // (tap again to clear it / clear its assignment).
    if (view.phase === 'block' && view.active !== view.myId && !view.spectator && !view.gameOver) {
      if (this.pendingBlocks.has(id)) {
        this.pendingBlocks.delete(id);
        this.selectedBlocker = null;
      } else {
        this.selectedBlocker = this.selectedBlocker === id ? null : id;
      }
      this.renderAll();
      return;
    }

    // Blockers-mode attack: tapping toggles the creature as a declared attacker.
    if (view.rules.combatStyle === 'blockers' && myTurn && view.phase === 'combat') {
      const declared = view.attackers.includes(id);
      const canAct = creature.ready && creature.attacksUsed < view.rules.attacksPerTurn && creature.attack > 0;
      if (declared || canAct) {
        this.send({ type: 'attack', player: view.myId, attackerId: id, target: { kind: 'face' } });
        return;
      }
      this.inspect(creature.def, creature);
      return;
    }

    const canAct =
      myTurn && view.phase === 'combat' &&
      creature.ready && creature.attacksUsed < view.rules.attacksPerTurn && creature.attack > 0;
    if (!canAct) {
      // Not an actionable click — open the card for a closer look instead.
      this.inspect(creature.def, creature);
      return;
    }
    this.selectedAttacker = id;
    const sprite = this.myRow.spriteFor(id);
    if (sprite) {
      this.arrow.show(sprite.x, sprite.y - 40);
      this.tweens.add({ targets: sprite, scale: 1.06, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.showAttackTargets();
  }

  /** Finish a drag-to-attack: creature under the pointer, else the backfield = face. */
  private onAttackDrop(id: string, pointer: Phaser.Input.Pointer): void {
    if (this.selectedAttacker !== id) return;
    const { worldX: x, worldY: y } = pointer;
    const view = this.view;
    const target = this.oppRow.creatureAt(x, y, view.opponent.row);

    if (target) {
      this.send({ type: 'attack', player: view.myId, attackerId: id, target: { kind: 'creature', instanceId: target } });
      this.deselect();
      return;
    }
    // Dragging into enemy territory (or onto their portrait) attacks the player.
    if (y < ENEMY_TERRITORY_Y || this.hud.faceAt(x, y, view) === view.opponent.id) {
      if (!this.canAttackFace()) {
        this.toast('Enemy creatures are in the way — attack them first');
        this.deselect();
        return;
      }
      this.send({ type: 'attack', player: view.myId, attackerId: id, target: { kind: 'face' } });
    }
    this.deselect();
  }

  private onEnemyCreatureClick(id: string): void {
    const view = this.view;
    // Blockers-mode defense: with a blocker picked, tapping an attacking
    // enemy assigns the block.
    if (view.phase === 'block' && view.active !== view.myId && this.selectedBlocker) {
      if (!view.attackers.includes(id)) {
        this.toast('That creature is not attacking');
        return;
      }
      // One blocker per attacker: reassigning steals the block.
      for (const [blocker, attacker] of this.pendingBlocks) {
        if (attacker === id) this.pendingBlocks.delete(blocker);
      }
      this.pendingBlocks.set(this.selectedBlocker, id);
      this.selectedBlocker = null;
      this.renderAll();
      return;
    }
    if (!this.selectedAttacker) {
      const creature = this.view.opponent.row.find((c) => c?.instanceId === id);
      if (creature) this.inspect(creature.def, creature);
      return;
    }
    this.send({
      type: 'attack', player: this.view.myId, attackerId: this.selectedAttacker,
      target: { kind: 'creature', instanceId: id },
    });
    this.deselect();
  }

  private onFaceClick(player: number): void {
    if (!this.selectedAttacker) return;
    if (player === this.view.myId) return this.deselect();
    if (!this.canAttackFace()) {
      this.toast('Enemy creatures are in the way — attack them first');
      return this.deselect();
    }
    this.send({
      type: 'attack', player: this.view.myId, attackerId: this.selectedAttacker,
      target: { kind: 'face' },
    });
    this.deselect();
  }

  private deselect(): void {
    if (this.selectedAttacker) {
      const sprite = this.myRow.spriteFor(this.selectedAttacker);
      if (sprite) {
        this.tweens.killTweensOf(sprite);
        sprite.setScale(1);
      }
    }
    this.selectedAttacker = null;
    this.arrow.hide();
    this.clearTargets();
  }

  /** Enlarged card view — click anywhere to dismiss. */
  private inspect(def: CardDef, creature?: CreatureOnBoard): void {
    this.closeInspect();
    const shade = this.add
      .rectangle(W / 2, H / 2, W, H, 0x05080f, 0.72)
      .setDepth(940)
      .setInteractive();
    const card = new CardSprite(this, W / 2, H / 2 - 20, PORTRAIT ? 380 : 420, PORTRAIT ? 507 : 560, def, { creature });
    card.setDepth(941).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 180, ease: 'Back.easeOut' });
    const hint = this.add
      .text(W / 2, H / 2 + 320, 'click anywhere to close', {
        fontFamily: THEME.fonts.body, fontSize: '20px', color: THEME.hud.bannerIdle,
      })
      .setOrigin(0.5)
      .setDepth(941)
      .setAlpha(0.8);
    shade.once('pointerdown', () => this.closeInspect());
    this.inspectLayer = [shade, card, hint];
  }

  private closeInspect(): void {
    for (const obj of this.inspectLayer) {
      this.tweens.killTweensOf(obj);
      obj.destroy();
    }
    this.inspectLayer = [];
  }

  private findMyCreature(id: string): CreatureOnBoard | null {
    return this.view.you.row.find((c) => c?.instanceId === id) ?? null;
  }

  private send(cmd: Command): void {
    if (this.ended) return;
    this.conn.send(cmd);
  }

  // -------------------------------------------------------------- action FX

  /**
   * Turn engine events into visual feedback. Runs BEFORE the re-render, so
   * sprite positions from the outgoing frame can anchor the effects.
   */
  /** Event -> sound key (see src/audio.ts; add cases as you add sounds). */
  private playEventSound(ev: GameEvent): void {
    switch (ev.type) {
      case 'cardDrawn':
        if (ev.player === this.view.myId) playSound('draw');
        break;
      case 'creatureSummoned':
        playSound('summon');
        break;
      case 'attacked':
        playSound('attack');
        break;
      case 'attackerDeclared':
        playSound('click');
        break;
      case 'creatureDamaged':
        playSound('hit');
        break;
      case 'creatureHealed':
        playSound('heal');
        break;
      case 'creatureBuffed':
        playSound('buff');
        break;
      case 'creatureDied':
        playSound('death');
        break;
      case 'statusApplied':
        playSound('status');
        break;
      case 'gameOver':
        playSound(ev.winner === this.view.myId ? 'victory' : 'defeat');
        break;
    }
  }

  private playEventEffects(events: GameEvent[]): void {
    if (this.ended) return;
    const view = this.view;
    const creaturePos = (id: string): { x: number; y: number } | null => {
      const s = this.myRow.spriteFor(id) ?? this.oppRow.spriteFor(id);
      return s ? { x: s.x, y: s.y } : null;
    };

    for (const ev of events) {
      this.playEventSound(ev);
      switch (ev.type) {
        case 'turnStarted': {
          const mine = ev.player === view.myId;
          Fx.turnBanner(this, W, H, mine ? 'Your Turn' : "Opponent's Turn", mine ? THEME.hud.bannerActive : THEME.hud.bannerIdle);
          break;
        }
        case 'cardPlayed':
          if (ev.player !== view.myId) Fx.showcaseCard(this, W, H, ev.def);
          break;
        case 'cardDrawn': {
          // My draws animate inside HandLayout; the opponent's show as a card
          // back sliding from their deck counter into their hand fan.
          if (ev.player !== view.myId) {
            const back = new CardSprite(this, OPP_DECK_POS.x, OPP_DECK_POS.y, OPP_BACK.w, OPP_BACK.h, { id: 'fx-back', name: '', type: 'creature', cost: 0 }, { faceDown: true });
            back.setDepth(790).setScale(0.4).setAlpha(0.6);
            this.tweens.add({
              targets: back,
              x: OPP_HAND_POS.x, y: OPP_HAND_POS.y, scale: 1, alpha: 1,
              duration: 380, ease: 'Cubic.easeOut',
              onComplete: () => back.destroy(),
            });
          }
          break;
        }
        case 'attacked': {
          const from = creaturePos(ev.attackerId);
          const to =
            ev.targetKind === 'creature' && ev.targetId
              ? creaturePos(ev.targetId)
              : this.hud.portraitPos(ev.player === view.myId ? view.opponent.id : view.myId, view);
          if (from && to) {
            // Quick lunge streak from attacker to target.
            const streak = this.add.circle(from.x, from.y, 14, THEME.fx.arrow, 0.9).setDepth(790);
            this.tweens.add({
              targets: streak, x: to.x, y: to.y, duration: 160, ease: 'Cubic.easeIn',
              onComplete: () => { streak.destroy(); Fx.impact(this, to.x, to.y); },
            });
          }
          if (ev.targetKind === 'face') Fx.shake(this, ev.player !== view.myId);
          break;
        }
        case 'creatureDamaged': {
          const pos = creaturePos(ev.instanceId);
          if (pos) Fx.floatText(this, pos.x, pos.y - 30, `-${ev.amount}`, THEME.fx.damageText);
          break;
        }
        case 'creatureHealed': {
          const pos = creaturePos(ev.instanceId);
          if (pos) Fx.floatText(this, pos.x, pos.y - 30, `+${ev.amount}`, THEME.fx.healText);
          break;
        }
        case 'creatureBuffed': {
          const pos = creaturePos(ev.instanceId);
          if (pos) Fx.floatText(this, pos.x, pos.y - 30, '▲', THEME.fx.buffText);
          break;
        }
        case 'creatureDied': {
          const pos = creaturePos(ev.instanceId);
          if (pos) {
            Fx.deathPuff(this, pos.x, pos.y);
            // A ghost of the card drifts to its owner's discard side.
            const dead =
              view.you.row.find((c) => c?.instanceId === ev.instanceId) ??
              view.opponent.row.find((c) => c?.instanceId === ev.instanceId);
            if (dead) {
              const ghost = new CardSprite(this, pos.x, pos.y, 108, 144, dead.def, { creature: dead });
              ghost.setDepth(789).setAlpha(0.85);
              const target = ev.player === view.myId ? MY_GRAVE_POS : OPP_BURN_POS;
              this.tweens.add({
                targets: ghost,
                x: target.x, y: target.y, scale: 0.25, alpha: 0, angle: ev.player === view.myId ? 25 : -25,
                duration: 550, ease: 'Cubic.easeIn',
                onComplete: () => ghost.destroy(),
              });
            }
          }
          break;
        }
        case 'skillTriggered': {
          const pos = creaturePos(ev.instanceId);
          if (pos) Fx.floatText(this, pos.x, pos.y - 70, `${ev.icon} ${ev.skill}`, THEME.fx.buffText);
          break;
        }
        case 'statusApplied': {
          const pos = creaturePos(ev.instanceId);
          if (pos) {
            Fx.floatText(this, pos.x, pos.y - 70, `${ev.icon} ${ev.status}${ev.value ? ` ${ev.value}` : ''}`, THEME.fx.damageText);
          }
          break;
        }
        case 'statusExpired': {
          const pos = creaturePos(ev.instanceId);
          if (pos) Fx.floatText(this, pos.x, pos.y - 70, `${ev.icon} ${ev.status} wore off`, THEME.fx.healText);
          break;
        }
        case 'lifeChanged': {
          const pos = this.hud.portraitPos(ev.player, view);
          Fx.floatText(this, pos.x + 60, pos.y, `${ev.delta > 0 ? '+' : ''}${ev.delta}`, ev.delta < 0 ? THEME.fx.damageText : THEME.fx.healText);
          break;
        }
        case 'equipmentAttached': {
          const pos = creaturePos(ev.targetInstanceId);
          if (pos) Fx.impact(this, pos.x, pos.y, THEME.fx.glowFriendly);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------- log & toasts

  private pushLog(events: GameEvent[]): void {
    for (const ev of events) {
      const line = this.formatEvent(ev);
      if (line) this.logLines.push(line);
    }
    this.logLines = this.logLines.slice(-LOG.lines);
  }

  private formatEvent(ev: GameEvent): string | null {
    const view = this.view;
    const who = (p: number) => (p === view.myId ? 'You' : 'Opponent');
    switch (ev.type) {
      case 'turnStarted':
        return `— Turn ${ev.turn}: ${who(ev.player)} —`;
      case 'cardDrawn':
        return ev.player === view.myId && ev.cardName ? `You drew ${ev.cardName}` : `${who(ev.player)} drew a card`;
      case 'cardPlayed':
        return `${who(ev.player)} played ${ev.cardName}`;
      case 'attacked':
        return ev.targetKind === 'face'
          ? `${ev.attackerName} attacked ${ev.player === view.myId ? 'the enemy' : 'you'} directly`
          : `${ev.attackerName} attacked ${ev.targetName}`;
      case 'creatureDied':
        return `${ev.cardName} was destroyed`;
      case 'skillTriggered':
        return `${ev.cardName}: ${ev.skill}`;
      case 'statusApplied':
        return `${ev.cardName} is ${ev.status.toLowerCase()}${ev.value ? ` ${ev.value}` : ''}`;
      case 'statusExpired':
        return `${ev.status} wore off`;
      case 'attackerDeclared':
        return ev.declared ? `${ev.cardName} joins the attack` : `${ev.cardName} stands down`;
      case 'blocksDeclared':
        return `${who(ev.player)} declared ${ev.count} blocker${ev.count === 1 ? '' : 's'}`;
      case 'mulligan':
        return `${who(ev.player)} mulliganed ${ev.count} cards`;
      case 'fatigue':
        return `${who(ev.player)} ran out of cards!`;
      case 'gameOver':
        return `${who(ev.winner)} won: ${ev.reason}`;
      default:
        return null;
    }
  }

  private toast(msg: string): void {
    const t = this.add
      .text(W / 2, BENCH_TOP - 60, msg, {
        fontFamily: THEME.fonts.body, fontSize: '26px', color: THEME.fx.toastText,
        backgroundColor: THEME.fx.toastBg, padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(900);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, delay: 1200, duration: 500, onComplete: () => t.destroy() });
  }

  /**
   * Small first-round chooser: keep the opening hand or shuffle it back for
   * a fresh one (see rules.mulligan). Sits above the hand, never blocks play
   * — touching anything else just means "keep".
   */
  private showMulliganPrompt(): void {
    const c = this.add.container(W / 2, H * 0.56).setDepth(900);
    this.mulliganUi = c;
    const g = this.add.graphics();
    g.fillStyle(THEME.fx.overlayPanel, 0.95);
    g.fillRoundedRect(-250, -46, 500, 92, 14);
    g.lineStyle(2, THEME.fx.overlayAccent, 1);
    g.strokeRoundedRect(-250, -46, 500, 92, 14);
    c.add(g);
    c.add(
      this.add.text(0, -22, 'Keep this hand?', {
        fontFamily: THEME.fonts.body, fontSize: '19px', color: THEME.fx.overlayText,
      }).setOrigin(0.5)
    );
    const mkBtn = (x: number, label: string, primary: boolean, onClick: () => void): void => {
      const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
      const t = this.add
        .text(x, 18, label, {
          fontFamily: THEME.fonts.display, fontSize: '22px',
          color: primary ? THEME.hud.buttonText : THEME.fx.overlayText,
          backgroundColor: css(primary ? THEME.hud.button : THEME.hud.chip),
          padding: { x: 20, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', onClick);
      c.add(t);
    };
    mkBtn(-100, 'KEEP', true, () => {
      this.mulliganDecided = true;
      c.destroy();
      this.mulliganUi = null;
    });
    mkBtn(110, 'MULLIGAN', false, () => {
      this.mulliganDecided = true;
      c.destroy();
      this.mulliganUi = null;
      this.send({ type: 'mulligan', player: this.view.myId });
    });
  }

  private showEndOverlay(title: string, subtitle: string): void {
    if (this.ended) return;
    this.ended = true;
    this.deselect();

    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setDepth(1000).setInteractive();
    const panel = this.add.graphics().setDepth(1001);
    panel.fillStyle(THEME.fx.overlayPanel, 0.97);
    panel.fillRoundedRect(W / 2 - 330, H / 2 - 190, 660, 380, 22);
    panel.lineStyle(4, THEME.fx.overlayAccent, 1);
    panel.strokeRoundedRect(W / 2 - 330, H / 2 - 190, 660, 380, 22);
    this.add
      .text(W / 2, H / 2 - 90, title, {
        fontFamily: THEME.fonts.display, fontSize: '64px', color: THEME.fx.overlayTitle,
      })
      .setOrigin(0.5)
      .setDepth(1002);
    this.add
      .text(W / 2, H / 2 - 10, subtitle, {
        fontFamily: THEME.fonts.body, fontSize: '24px', color: THEME.fx.overlayText,
        align: 'center', wordWrap: { width: 560 },
      })
      .setOrigin(0.5)
      .setDepth(1002);
    const replay = this.conn.getReplay?.();
    const btn = this.add
      .text(replay ? W / 2 - 130 : W / 2, H / 2 + 110, 'Back to Menu', {
        fontFamily: THEME.fonts.display, fontSize: '32px', color: THEME.hud.buttonText,
        backgroundColor: `#${THEME.hud.button.toString(16).padStart(6, '0')}`, padding: { x: 28, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(1002)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      shade.destroy();
      this.scene.start('Menu');
    });

    // Local games record themselves — offer the replay as a download.
    if (replay) {
      const save = this.add
        .text(W / 2 + 160, H / 2 + 110, '⬇ Replay', {
          fontFamily: THEME.fonts.display, fontSize: '26px', color: THEME.fx.overlayText,
          backgroundColor: `#${THEME.fx.overlayPanel.toString(16).padStart(6, '0')}`, padding: { x: 20, y: 12 },
        })
        .setOrigin(0.5)
        .setDepth(1002)
        .setInteractive({ useHandCursor: true });
      save.on('pointerdown', () => {
        const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tcg-replay-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
  }
}
