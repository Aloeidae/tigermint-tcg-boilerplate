import type { EffectTarget, PlayerId } from './types.js';

export type AttackTarget =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'face' };

/**
 * Commands are the only way to mutate a game. The client sends these to
 * whatever runs the engine (local AI match or the PvP server), which validates
 * them with applyCommand().
 */
export type Command =
  | {
      type: 'playCard';
      player: PlayerId;
      instanceId: string;
      /** Creature only: which row slot to summon into (first free slot if omitted). */
      slot?: number;
      /** Spell/equipment only: what the effect points at. */
      target?: EffectTarget;
    }
  /**
   * Targeted combat: attack the chosen target now. Blockers combat: TOGGLE
   * this creature as a declared attacker (target is ignored; attacks always
   * aim at the player and resolve after the block step).
   */
  | { type: 'attack'; player: PlayerId; attackerId: string; target: AttackTarget }
  /**
   * Blockers combat only, during the block phase, sent by the DEFENDER:
   * assign blockers (1:1 with attackers; empty = take it all to the face),
   * which resolves combat immediately.
   */
  | { type: 'declareBlockers'; player: PlayerId; blocks: { blocker: string; attacker: string }[] }
  | { type: 'advancePhase'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }
  /** Shuffle back the opening hand and redraw (rules.mulligan, first round only). */
  | { type: 'mulligan'; player: PlayerId }
  | { type: 'concede'; player: PlayerId }
  // ---- Pokemon game mode (rules.gameMode 'pokemon') ----
  /** Setup phase: place the opening Active (and optional Bench basics). Both players send one. */
  | { type: 'setup'; player: PlayerId; pinnedId: string; benchIds?: string[] }
  /** Play a basic sticker from hand onto the Bench (or the empty Active spot). */
  | { type: 'playSticker'; player: PlayerId; instanceId: string; slot?: number }
  /** Evolve: play a stage-1/2 sticker from hand on top of its lower stage. */
  | { type: 'upgrade'; player: PlayerId; instanceId: string; targetInstanceId: string }
  /** Attach one energy (reaction) card from hand — once per turn. */
  | { type: 'attachReaction'; player: PlayerId; instanceId: string; targetInstanceId: string }
  /** Attach a Tool (gift) — one per sticker. */
  | { type: 'attachGift'; player: PlayerId; instanceId: string; targetInstanceId: string }
  /** Play an Item/Supporter/Stadium (bot/admin/channel). */
  | { type: 'playTrainer'; player: PlayerId; instanceId: string; target?: EffectTarget }
  /** Use a once-per-turn trait on one of your stickers. */
  | { type: 'useTrait'; player: PlayerId; instanceId: string; target?: EffectTarget }
  /** Retreat: pay the Active's swap cost in energy, exchange it with a Bench sticker. */
  | { type: 'swap'; player: PlayerId; targetInstanceId: string }
  /** Attack with the Active's move. Ends the turn. */
  | { type: 'useMove'; player: PlayerId; moveIndex: number; target?: EffectTarget }
  /** After a knockout: pick the new Active. Sent by whoever lost theirs. */
  | { type: 'promote'; player: PlayerId; targetInstanceId: string };
