/**
 * Pokémon-TCG-style game mode ("league" rules): Active/Bench, energy
 * attachment, HP with damage, evolution, prizes, weakness/resistance,
 * retreat, and Item/Supporter/Stadium/Tool trainers.
 *
 * Cards opt in through `CardDef.game` — a self-contained block that mirrors
 * the pack-generator output (see pokemonref/): the legacy type/cost/attack/
 * health fields keep the card playable under the standard engine, and this
 * block is what the pokemon engine reads. The vocabulary follows the
 * generator schema (sticker = Pokémon, reaction = Energy, bot = Item,
 * admin = Supporter, channel = Stadium, gift = Tool); rename freely in your
 * own skin — the keys are data, not UI.
 */

/** The elemental wheel. 'Neutral' is colorless; 'Any' is a wildcard provider. */
export type ReactionType =
  | 'Blaze' | 'Chill' | 'Zap' | 'Solid' | 'Mind' | 'Gross' | 'Heart' | 'Chaos'
  | 'Neutral' | 'Any';

export type PokemonCardKind = 'sticker' | 'reaction' | 'bot' | 'admin' | 'channel' | 'gift';

export type Stage = 'Static' | 'Animated' | 'Premium';

/** One entry of the effect DSL (see pokemon/ops.ts for the interpreter). */
export interface EffectOp {
  op: string;
  [k: string]: unknown;
}

/** One attack on a sticker card. */
export interface PokemonMove {
  name: string;
  /** Energy cost; 'Neutral' entries accept any attached type. */
  cost: ReactionType[];
  /** Base damage before modifiers; 0 for flip-based moves. */
  damage: number;
  /** Printed damage text, e.g. "60", "30×", "". */
  damageText?: string;
  /** Average damage, used by the AI to rank moves. */
  expectedDamage?: number;
  text?: string;
  effects?: EffectOp[];
}

export type TraitTrigger =
  | 'static' | 'onPlay' | 'onTurnStart' | 'oncePerTurn'
  | 'onDamaged' | 'onKO' | 'onKOOpponent';

/** A passive ability (Pokémon "Ability"). Never costs energy. */
export interface Trait {
  key: string;
  name: string;
  text?: string;
  trigger: TraitTrigger;
  effects: EffectOp[];
}

export interface StickerGame {
  kind: 'sticker';
  stage: Stage;
  /** 0 = basic (playable from hand), 1/2 = evolutions. */
  stageIndex: 0 | 1 | 2;
  /** Star sticker (Pokémon-ex): strong from turn one, gives extra prizes. */
  star?: boolean;
  /** Card id (or name) of the stage below; evolutions play on top of it. */
  upgradesFrom?: string | null;
  type: ReactionType;
  typeEmoji?: string;
  hp: number;
  trait?: Trait | null;
  moves: PokemonMove[];
  weakness?: ReactionType | null;
  resistance?: ReactionType | null;
  /** Retreat cost, in attached energy discarded. */
  swapCost: number;
  /** Prizes the opponent takes when this is knocked out (2 for stars). */
  starsOnKO?: number;
}

export interface TrainerGame {
  kind: 'bot' | 'admin' | 'channel' | 'gift';
  text?: string;
  effects: EffectOp[];
}

export interface ReactionGame {
  kind: 'reaction';
  type: ReactionType;
  typeEmoji?: string;
  /** Special reactions are capped at 4 per deck; basics are unlimited. */
  special?: boolean;
  /** What it counts as: types, 'Any' wildcard, or 'Own' (the bearer's type). */
  provides?: (ReactionType | 'Own')[];
  text?: string;
  effects?: EffectOp[];
}

export type GameBlock = StickerGame | TrainerGame | ReactionGame;

/** Per-turn action flags for one player (reset at their turn start). */
export interface PokemonTurnFlags {
  /** The once-per-turn energy attachment from hand. */
  energy: boolean;
  /** The one Supporter (admin) per turn. */
  supporter: boolean;
  /** The one Stadium (channel) per turn. */
  stadium: boolean;
  /** The once-per-turn retreat. */
  swap: boolean;
  /** Extra attachment granted by a trait/stadium (extraAttach op). */
  extraAttach: boolean;
  /** Stadium's once-per-turn conditional draw (conditionalDraw op). */
  stadiumDraw: boolean;
  /** Cards played this turn by kind (limitKind caps, e.g. Slow Mode). */
  played: Record<string, number>;
  /** Kinds locked for the rest of the turn (lockKind op). */
  locked: string[];
}

export function freshTurnFlags(): PokemonTurnFlags {
  return {
    energy: false, supporter: false, stadium: false, swap: false,
    extraAttach: false, stadiumDraw: false, played: {}, locked: [],
  };
}

/** The energy types a set of provides-lists yields, with 'Own' resolved. */
export function providedTypes(
  reactions: { provides?: (ReactionType | 'Own')[]; type?: ReactionType }[],
  ownType: ReactionType
): ReactionType[] {
  const pool: ReactionType[] = [];
  for (const r of reactions) {
    const provides = r.provides ?? [r.type ?? 'Neutral'];
    for (const p of provides) pool.push(p === 'Own' ? ownType : p);
  }
  return pool;
}

/**
 * Does a set of attached reactions cover a move's cost? Typed cost entries
 * need that type (or an 'Any' wildcard); 'Neutral' entries accept anything.
 */
export function coversCost(
  attached: { provides?: (ReactionType | 'Own')[]; type?: ReactionType }[],
  cost: ReactionType[],
  ownType: ReactionType
): boolean {
  const pool = providedTypes(attached, ownType);
  const typed = cost.filter((c) => c !== 'Neutral');
  const remaining = [...pool];
  for (const t of typed) {
    let i = remaining.indexOf(t);
    if (i === -1) i = remaining.indexOf('Any');
    if (i === -1) return false;
    remaining.splice(i, 1);
  }
  return remaining.length >= cost.length - typed.length;
}

// --- Narrowing helpers -----------------------------------------------------

export function stickerGame(def: { game?: GameBlock }): StickerGame | null {
  return def.game?.kind === 'sticker' ? def.game : null;
}

export function reactionGame(def: { game?: GameBlock }): ReactionGame | null {
  return def.game?.kind === 'reaction' ? def.game : null;
}

export function trainerGame(def: { game?: GameBlock }): TrainerGame | null {
  const g = def.game;
  return g && (g.kind === 'bot' || g.kind === 'admin' || g.kind === 'channel' || g.kind === 'gift')
    ? (g as TrainerGame)
    : null;
}

/** A basic sticker — playable straight from hand (stage 0, stars included). */
export function isBasicSticker(def: { game?: GameBlock }): boolean {
  const g = stickerGame(def);
  return !!g && g.stageIndex === 0;
}
