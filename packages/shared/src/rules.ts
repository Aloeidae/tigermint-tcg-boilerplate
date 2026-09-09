import { DECK_SIZE, MAX_HAND, MAX_MANA, MAX_ROW, OPENING_HAND, STARTING_LIFE } from './constants.js';

/**
 * Every rules knob the engine reads at runtime. Rules travel inside GameState,
 * so the server, both clients, and the AI always agree on them. Tweak these —
 * or add your own fields and read them in engine/combat/helpers — to shape
 * your game after whichever TCG you're channeling.
 */
export interface RulesConfig {
  startingLife: number;
  deckSize: number;
  openingHand: number;
  maxHand: number;
  maxRow: number;
  manaCap: number;
  /** Does the player who goes first also draw on turn 1? (Mana Clash: no) */
  firstPlayerDraws: boolean;
  /** Creatures can't attack the turn they are summoned. */
  summoningSickness: boolean;
  /** How many attacks each creature can make per turn. */
  attacksPerTurn: number;
  /**
   * Enemy creatures "guard" their player: while any are on the row, you must
   * attack creatures — the face is off-limits. (Think taunt-everything.)
   */
  mustAttackCreaturesFirst: boolean;
  /** Defending creatures strike back when attacked. */
  retaliation: boolean;
  /**
   * Drawing from an empty deck: 'lose' the game instantly (Mana Clash), or
   * take 'damage' that grows by 1 with every empty draw (Tavern Clash).
   */
  fatigue: 'lose' | 'damage';
  /**
   * Each player may shuffle back their opening hand once, during the first
   * round, and redraw the same number of cards (a free mulligan).
   */
  mulligan: boolean;
  /**
   * How combat works.
   * 'targeted': the attacker picks each attack's target — an enemy creature
   *   or the face (Tavern Clash style).
   * 'blockers': Mana Clash style — attacks are declared against the PLAYER,
   *   the defender assigns blockers, blocked attackers fight their blocker and
   *   unblocked ones hit the face. Attackers never choose creature targets.
   */
  combatStyle: 'targeted' | 'blockers';
  /**
   * Which engine runs the game.
   * 'standard': the mana/creature engine above (all knobs apply).
   * 'pocket': Pocket League-TCG-style rules (pocket/engine.ts) — Active + Bench,
   *   energy attachment, prizes, evolution, retreat, weakness/resistance.
   *   Cards need a `game` block; mana, combatStyle, and the standard combat
   *   knobs are ignored. Slot 0 of the row is the Active, the rest the Bench.
   * 'rows': Three-Rows-style rules (rows/engine.ts) — no mana, one card per
   *   turn, three battlefield rows, power totals, best-of-3 rounds decided by
   *   passing. Cards need a `rows` block; startingLife is the round lives (2).
   */
  gameMode: 'standard' | 'pocket' | 'rows';
  /** Pocket mode: prize cards per player (take the last one to win). */
  prizes: number;
  /** Pocket mode: prizes awarded for knocking out a star sticker. */
  starPrizes: number;
  /** Pocket mode: the first player cannot attack on turn 1. */
  firstTurnNoAttack: boolean;
  /** Pocket mode: the first player cannot play a Supporter on turn 1. */
  firstTurnNoSupporter: boolean;
  /** Pocket mode: weakness multiplies move damage (×2). */
  weaknessMultiplier: number;
  /** Pocket mode: resistance subtracts from move damage (−20). */
  resistanceAmount: number;
  /**
   * Standard engine only: a once-per-turn hero power (Tavern Clash flavor).
   * 'strike' costs 2 mana and deals 1 damage to any creature or the face.
   * Add your own powers by extending the union and the engine's heroPower case.
   */
  heroPower: 'none' | 'strike';
}

export const DEFAULT_RULES: RulesConfig = {
  startingLife: STARTING_LIFE,
  deckSize: DECK_SIZE,
  openingHand: OPENING_HAND,
  maxHand: MAX_HAND,
  maxRow: MAX_ROW,
  manaCap: MAX_MANA,
  firstPlayerDraws: false,
  summoningSickness: true,
  attacksPerTurn: 1,
  mustAttackCreaturesFirst: false,
  retaliation: true,
  fatigue: 'lose',
  mulligan: false,
  combatStyle: 'targeted',
  gameMode: 'standard',
  prizes: 6,
  starPrizes: 2,
  firstTurnNoAttack: true,
  firstTurnNoSupporter: true,
  weaknessMultiplier: 2,
  resistanceAmount: 20,
  heroPower: 'none',
};

/**
 * Pocket-mode baselines. `maxRow` is 1 Active + the Bench; the row array
 * gets one slot of headroom so a benchSize +1 Stadium (Megagroup) fits.
 */
export const POCKET_STANDARD: RulesConfig = {
  ...DEFAULT_RULES,
  gameMode: 'pocket',
  deckSize: 60,
  openingHand: 7,
  maxHand: 99,
  maxRow: 6, // Active + Bench 5
  prizes: 6,
  firstPlayerDraws: true,
  fatigue: 'lose',
};

export const POCKET_QUICK: RulesConfig = {
  ...POCKET_STANDARD,
  deckSize: 30,
  openingHand: 5,
  maxRow: 4, // Active + Bench 3
  prizes: 3,
  firstPlayerDraws: false,
  firstTurnNoSupporter: false,
};

/**
 * Rows-mode baseline: no mana, the whole game is fought from one 10-card
 * hand, and `startingLife` is round lives — lose two rounds and you're out.
 */
export const ROWS_STANDARD: RulesConfig = {
  ...DEFAULT_RULES,
  gameMode: 'rows',
  deckSize: 25,
  openingHand: 10,
  maxHand: 20,
  startingLife: 2,
  firstPlayerDraws: false,
  mulligan: false,
};

/**
 * Ready-made variants flavored after popular TCGs. The menu offers these;
 * add your own preset here and it appears automatically.
 */
export const RULE_PRESETS: Record<string, { label: string; description: string; rules: RulesConfig }> = {
  duel: {
    label: 'Mana Clash: Duel',
    description:
      'The classic stack-and-blockers duel: attack the player, the defender declares blockers. Free mulligan. Empty-deck draw loses.',
    rules: { ...DEFAULT_RULES, mulligan: true, combatStyle: 'blockers' },
  },
  tavern: {
    label: 'Tavern Clash',
    description:
      'Cozy inn brawling: pick every attack target, mana grows to 10, 30 life, empty-deck draws burn you, and a once-per-turn hero power (2 mana: 1 damage anywhere).',
    rules: {
      ...DEFAULT_RULES,
      combatStyle: 'targeted',
      manaCap: 10,
      startingLife: 30,
      fatigue: 'damage',
      firstPlayerDraws: false,
      heroPower: 'strike',
    },
  },
  league: {
    label: 'Pocket League: Quick',
    description:
      'Active & Bench, energy attachment, evolution, retreat, 3 prizes. 30-card decks, Bench of 3.',
    rules: { ...POCKET_QUICK },
  },
  rows: {
    label: 'Three Rows',
    description:
      'Battlefield rows and bluffing: no mana, one card a turn, pass to bank your lead. Best of three rounds — spies, weather, horns and scorch swing the board.',
    rules: { ...ROWS_STANDARD },
  },
  leagueStandard: {
    label: 'Pocket League: Standard',
    description:
      'The full league ruleset: 60-card decks, 7-card hands, Bench of 5, 6 prizes, first player cannot attack or play a Supporter on turn 1.',
    rules: { ...POCKET_STANDARD },
  },
};

/**
 * Merge a (possibly untrusted) partial config onto the defaults, keeping only
 * known keys with sane types and clamped ranges. The PvP server runs client
 * -submitted rules through this.
 */
export function mergeRules(partial?: Partial<RulesConfig> | null): RulesConfig {
  const r = { ...DEFAULT_RULES };
  if (!partial || typeof partial !== 'object') return r;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

  r.startingLife = num(partial.startingLife, 1, 999, r.startingLife);
  r.deckSize = num(partial.deckSize, 5, 200, r.deckSize);
  r.openingHand = num(partial.openingHand, 0, 10, r.openingHand);
  r.maxHand = num(partial.maxHand, 1, 20, r.maxHand);
  r.maxRow = num(partial.maxRow, 1, 8, r.maxRow);
  r.manaCap = num(partial.manaCap, 1, 20, r.manaCap);
  r.attacksPerTurn = num(partial.attacksPerTurn, 1, 9, r.attacksPerTurn);
  r.firstPlayerDraws = bool(partial.firstPlayerDraws, r.firstPlayerDraws);
  r.summoningSickness = bool(partial.summoningSickness, r.summoningSickness);
  r.mustAttackCreaturesFirst = bool(partial.mustAttackCreaturesFirst, r.mustAttackCreaturesFirst);
  r.retaliation = bool(partial.retaliation, r.retaliation);
  r.fatigue = partial.fatigue === 'damage' ? 'damage' : partial.fatigue === 'lose' ? 'lose' : r.fatigue;
  r.mulligan = bool(partial.mulligan, r.mulligan);
  r.combatStyle =
    partial.combatStyle === 'blockers' ? 'blockers' : partial.combatStyle === 'targeted' ? 'targeted' : r.combatStyle;
  r.gameMode =
    partial.gameMode === 'pocket' ? 'pocket'
    : partial.gameMode === 'rows' ? 'rows'
    : partial.gameMode === 'standard' ? 'standard'
    : r.gameMode;
  r.prizes = num(partial.prizes, 1, 10, r.prizes);
  r.starPrizes = num(partial.starPrizes, 1, 3, r.starPrizes);
  r.firstTurnNoAttack = bool(partial.firstTurnNoAttack, r.firstTurnNoAttack);
  r.firstTurnNoSupporter = bool(partial.firstTurnNoSupporter, r.firstTurnNoSupporter);
  r.weaknessMultiplier = num(partial.weaknessMultiplier, 1, 4, r.weaknessMultiplier);
  r.resistanceAmount = num(partial.resistanceAmount, 0, 100, r.resistanceAmount);
  r.heroPower = partial.heroPower === 'strike' ? 'strike' : partial.heroPower === 'none' ? 'none' : r.heroPower;
  return r;
}
