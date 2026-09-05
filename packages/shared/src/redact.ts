import type { GameState, PlayerId, PlayerView } from './types.js';
import { other } from './helpers.js';

/**
 * Produce the view of the game one player is allowed to see: their own hand,
 * both rows, and only *counts* for the opponent's hand/deck and their own deck
 * order. The PvP server sends each client its redacted view; the local AI
 * match uses it too so the client code is identical in both modes.
 */
/**
 * The view a spectator (or replay watcher) gets: player 0's seat position,
 * but with NO hidden information — both hands are counts only.
 */
export function redactForSpectator(state: GameState): PlayerView {
  const view = redactFor(state, 0);
  view.spectator = true;
  view.you.handCount = view.you.hand.length;
  view.you.hand = [];
  return view;
}

export function redactFor(state: GameState, player: PlayerId): PlayerView {
  const me = state.players[player];
  const opp = state.players[other(player)];
  // Pokemon setup: the opponent's opening placement stays face-down until
  // both players are ready — send them an empty row.
  const setupPhase = state.phase === 'setup';
  const oppRow = setupPhase ? opp.row.map(() => null) : structuredClone(opp.row);
  return {
    myId: player,
    turn: state.turn,
    phase: state.phase,
    active: state.active,
    gameOver: state.gameOver,
    winner: state.winner,
    rules: state.rules,
    attackers: [...state.attackers],
    blocks: state.blocks.map((b) => ({ ...b })),
    channel: state.channel ? structuredClone(state.channel) : state.channel,
    pendingPromote: state.pendingPromote,
    you: {
      id: me.id,
      name: me.name,
      life: me.life,
      mana: me.mana,
      maxMana: me.maxMana,
      hand: structuredClone(me.hand),
      deckCount: me.deck.length,
      row: structuredClone(me.row),
      graveyardCount: me.graveyard.length,
      mulliganUsed: me.mulliganUsed,
      // Prize CONTENTS stay hidden from everyone, including their owner.
      prizeCount: me.prizes?.length,
      prizesTaken: me.prizesTaken,
      turnFlags: me.turnFlags ? structuredClone(me.turnFlags) : undefined,
      ready: state.setupDone ? state.setupDone[me.id] : undefined,
    },
    opponent: {
      id: opp.id,
      name: opp.name,
      life: opp.life,
      mana: opp.mana,
      maxMana: opp.maxMana,
      handCount: opp.hand.length,
      deckCount: opp.deck.length,
      row: oppRow,
      graveyardCount: opp.graveyard.length,
      prizeCount: opp.prizes?.length,
      prizesTaken: opp.prizesTaken,
      ready: state.setupDone ? state.setupDone[opp.id] : undefined,
    },
  };
}
