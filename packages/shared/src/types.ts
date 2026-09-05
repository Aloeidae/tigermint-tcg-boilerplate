import type { RulesConfig } from './rules.js';
import type { GameBlock, PokemonTurnFlags } from './pokemon/types.js';

export type PlayerId = 0 | 1;

export type CardType = 'creature' | 'equipment' | 'spell';

/**
 * Phases of a turn. `draw` and `end` resolve automatically inside the engine;
 * the active player steps through main1 -> combat -> main2 with AdvancePhase.
 * `block` exists only under blockers-style combat: after attackers are
 * declared, the DEFENDER assigns blockers before damage resolves.
 * `setup` exists only in the pokemon game mode: both players pick their
 * opening Active (and optional Bench) before turn 1 starts.
 */
export type Phase = 'main1' | 'combat' | 'block' | 'main2' | 'setup';

/** One declared block: a defending creature intercepting one attacker. */
export interface BlockPair {
  blocker: string;
  attacker: string;
}

/** Where an effect (spell or equipment) may be pointed. */
export type EffectTarget =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'face'; player: PlayerId }
  | { kind: 'none' };

/** What kind of target an effect requires — used by UI and AI for validation. */
export type TargetSpec =
  | 'none'
  | 'friendly-creature'
  | 'enemy-creature'
  | 'any-creature'
  | 'any' // any creature or a player's face
  | 'friendly'; // friendly creature or your own face

export interface EffectRef {
  /** Key registered in effects.ts (e.g. 'damage', 'heal', 'draw', 'buffAttack', 'aoeDamage'). */
  key: string;
  amount?: number;
}

/**
 * A skill (keyword ability) on a card: a key registered in skills.ts plus an
 * optional magnitude (e.g. { key: 'armor', value: 2 }). On equipment, skills
 * are granted to the creature wearing it.
 */
export interface SkillRef {
  key: string;
  value?: number;
}

/**
 * A status (ticking condition) sitting on a board creature: a key registered
 * in statuses.ts plus an optional magnitude and duration in the bearer's own
 * turns (no turns = until it dies or the status ends itself).
 */
export interface StatusRef {
  key: string;
  value?: number;
  turns?: number;
}

/**
 * The immutable definition of a card — what a card *is*.
 * NFT-derived cards and demo-catalog cards both produce these.
 */
export interface CardDef {
  /** Stable id. For NFT cards this is the NFT item address. */
  id: string;
  name: string;
  type: CardType;
  cost: number;
  /** Rules text shown on the card. */
  text?: string;
  /** Art reference: a texture key or an image URL (NFT image). */
  art?: string;
  /**
   * Card style. false/undefined: the system draws a card frame and uses `art`
   * for the art window. true: the NFT image IS the whole card (for
   * collections whose art is a finished card design) — the client renders it
   * full-bleed and only overlays live values like cost and current stats.
   */
  fullArt?: boolean;
  /**
   * Pull-weight tier from the mint (LEGENDARY / EPIC / RARE / COMMON).
   * Cosmetic in-game — the deck builder tints card glows with it.
   */
  rarity?: string;
  /** Creature stats. */
  attack?: number;
  health?: number;
  /** Equipment stat bonuses. */
  attackBonus?: number;
  healthBonus?: number;
  /** Spell (or on-attach equipment) effect. */
  effect?: EffectRef;
  /**
   * Keyword skills (see skills.ts). On a creature they are its abilities;
   * on equipment they are granted to the wearer while attached.
   */
  skills?: SkillRef[];
  /**
   * Pokemon-mode definition (see pokemon/types.ts). Cards that carry one are
   * playable under `rules.gameMode: 'pokemon'`; the legacy fields above keep
   * the same card playable under the standard engine.
   */
  game?: GameBlock;
}

/** A concrete copy of a card inside one game (deck/hand/graveyard). */
export interface CardInstance {
  instanceId: string;
  def: CardDef;
}

/** A creature currently on the battlefield row. */
export interface CreatureOnBoard {
  instanceId: string;
  def: CardDef;
  attack: number;
  health: number;
  maxHealth: number;
  /** False the turn it is summoned (summoning sickness). */
  ready: boolean;
  attacksUsed: number;
  /** Equipment attached to this creature. */
  equipment: CardInstance[];
  /** Active statuses (Poison, Frozen, Shield… — see statuses.ts). */
  statuses: StatusRef[];

  // ---- Pokemon mode only (rules.gameMode 'pokemon') ----
  /** Attached energy (reaction) cards — public information. */
  reactions?: CardInstance[];
  /** The one attached Tool (gift), if any. */
  gift?: CardInstance | null;
  /** Cards underneath after evolutions (bottom stage first). */
  stack?: CardInstance[];
  /** Turn it entered play — can't evolve the turn it arrived. */
  enteredTurn?: number;
  /** Its once-per-turn trait has been used this turn. */
  traitUsed?: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  mana: number;
  maxMana: number;
  deck: CardInstance[];
  hand: CardInstance[];
  /** Fixed-size battlefield row; null = empty slot. */
  row: (CreatureOnBoard | null)[];
  graveyard: CardInstance[];
  /** Empty-deck draws so far (drives 'damage'-mode fatigue). */
  fatigue: number;
  /** Whether this player has spent their opening-hand mulligan. */
  mulliganUsed: boolean;

  // ---- Pokemon mode only ----
  /** Face-down prize cards. Taking the last one wins the game. */
  prizes?: CardInstance[];
  /** Prizes taken so far (drives bonusPerPrizeTaken and the HUD). */
  prizesTaken?: number;
  /** Per-turn action flags (energy attachment, supporter, retreat…). */
  turnFlags?: PokemonTurnFlags;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  active: PlayerId;
  phase: Phase;
  turn: number;
  gameOver: boolean;
  winner: PlayerId | null;
  seed: number;
  rules: RulesConfig;
  /** Monotonic counter for token instance ids (see registerToken). */
  nextTokenId: number;
  /** Blockers-style combat: instanceIds declared as attackers this combat. */
  attackers: string[];
  /** Blockers-style combat: the defender's declared blocks. */
  blocks: BlockPair[];

  // ---- Pokemon mode only ----
  /** The Stadium (channel) in play — shared, affects both players. */
  channel?: { card: CardInstance; owner: PlayerId } | null;
  /** A player must pick a new Active after a knockout before play continues. */
  pendingPromote?: PlayerId | null;
  /** The turn was ending when the knockout happened; finish it after promote. */
  endTurnAfterPromote?: boolean;
  /** Setup phase: which players have placed their opening board. */
  setupDone?: [boolean, boolean];
  /** Deterministic coin-flip cursor (advances with every flip). */
  rngCursor?: number;
}

/** What one player is allowed to see. Produced by redact.ts. */
export interface OpponentView {
  id: PlayerId;
  name: string;
  life: number;
  mana: number;
  maxMana: number;
  handCount: number;
  deckCount: number;
  row: (CreatureOnBoard | null)[];
  graveyardCount: number;
  /** Pokemon mode: face-down prizes left / taken so far. */
  prizeCount?: number;
  prizesTaken?: number;
  /** Pokemon mode setup: this player has placed their opening board. */
  ready?: boolean;
}

export interface SelfView {
  id: PlayerId;
  name: string;
  life: number;
  mana: number;
  maxMana: number;
  hand: CardInstance[];
  deckCount: number;
  row: (CreatureOnBoard | null)[];
  graveyardCount: number;
  mulliganUsed: boolean;
  /** Spectator views only: the hidden hand's size (hand itself is empty). */
  handCount?: number;
  /** Pokemon mode: face-down prizes left / taken so far (contents hidden). */
  prizeCount?: number;
  prizesTaken?: number;
  /** Pokemon mode: my per-turn action flags (for graying out the UI). */
  turnFlags?: PokemonTurnFlags;
  /** Pokemon mode setup: I have placed my opening board. */
  ready?: boolean;
}

export interface PlayerView {
  myId: PlayerId;
  turn: number;
  phase: Phase;
  active: PlayerId;
  gameOver: boolean;
  winner: PlayerId | null;
  /** The match's rules, so the UI/AI can reflect them (e.g. guard rules). */
  rules: RulesConfig;
  /** True for spectator/replay views: no seat, no hidden info, no input. */
  spectator?: boolean;
  /** Blockers-style combat state (public information). */
  attackers: string[];
  blocks: BlockPair[];
  /** Pokemon mode: the Stadium in play (public). */
  channel?: { card: CardInstance; owner: PlayerId } | null;
  /** Pokemon mode: who must promote a new Active before play continues. */
  pendingPromote?: PlayerId | null;
  you: SelfView;
  opponent: OpponentView;
}
