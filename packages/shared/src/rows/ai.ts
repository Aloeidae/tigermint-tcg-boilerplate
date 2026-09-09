import type { CardInstance, GameState, PlayerId } from '../types.js';
import type { Command } from '../commands.js';
import { other } from '../helpers.js';
import { WEATHER_ROW, type RowKind, ROW_KINDS } from './types.js';
import { rowPower, totalPower, unitsInPlay } from './power.js';

/**
 * A straightforward rows opponent: spies first (card advantage is king),
 * removal and weather when they swing the board, otherwise the biggest unit —
 * and it knows when a round is already won or not worth chasing.
 */
export function chooseRowsCommand(state: GameState, me: PlayerId): Command {
  const r = state.rowsRound!;
  const p = state.players[me];
  const opp = other(me);
  const myTotal = totalPower(state, me);
  const oppTotal = totalPower(state, opp);
  const oppPassed = r.passed[opp];

  if (p.hand.length === 0) return { type: 'pass', player: me };
  // The round is banked: they passed and we lead.
  if (oppPassed && myTotal > oppTotal) return { type: 'pass', player: me };

  const play = (card: CardInstance, row?: RowKind): Command => ({
    type: 'playRowsCard', player: me, instanceId: card.instanceId, row,
  });
  const unitRow = (card: CardInstance): RowKind | undefined =>
    card.def.rows?.row === 'agile' ? 'melee' : undefined;
  const unitCards = p.hand
    .filter((c) => c.def.rows?.kind === 'unit')
    .sort((a, b) => (b.def.rows?.power ?? 0) - (a.def.rows?.power ?? 0));

  // They passed and we trail: can the rest of the hand even catch up?
  if (oppPassed) {
    const reachable = myTotal + unitCards
      .filter((c) => c.def.rows?.ability !== 'spy')
      .reduce((s, c) => s + (c.def.rows?.power ?? 0), 0);
    if (reachable <= oppTotal) return { type: 'pass', player: me };
    // Catch up with the smallest unit that flips the lead, wasting nothing.
    const flip = [...unitCards].reverse().find(
      (c) => c.def.rows?.ability !== 'spy' && myTotal + (c.def.rows?.power ?? 0) > oppTotal
    );
    if (flip) return play(flip, unitRow(flip));
  }

  // Spies cost us nothing this round and refill the hand.
  const spy = unitCards.find((c) => c.def.rows?.ability === 'spy');
  if (spy) return play(spy, unitRow(spy));

  // Scorch when their best non-hero unit out-sizes ours.
  const scorch = p.hand.find((c) => c.def.rows?.special === 'scorch');
  if (scorch) {
    const burnable = unitsInPlay(state).filter((u) => !u.unit.def.rows?.hero);
    const max = burnable.reduce((m, u) => Math.max(m, u.power), 0);
    if (max >= 8 && burnable.filter((u) => u.power === max).every((u) => u.owner === opp)) {
      return play(scorch);
    }
  }

  // Weather that costs them clearly more than us; clear when it's on us.
  for (const card of p.hand) {
    const s = card.def.rows?.special;
    if (s !== 'frost' && s !== 'fog' && s !== 'rain') continue;
    const row = WEATHER_ROW[s];
    if (r.weather[row]) continue;
    const loss = (side: PlayerId): number =>
      state.players[side].rowsBoard![row].reduce(
        (sum, u) => (u.def.rows?.hero ? sum : sum + Math.max(0, (u.def.rows?.power ?? 0) - 1)), 0
      );
    if (loss(opp) - loss(me) >= 6) return play(card);
  }
  const clear = p.hand.find((c) => c.def.rows?.special === 'clear');
  if (clear && ROW_KINDS.some((row) => r.weather[row])) {
    const myRaw = ROW_KINDS.reduce((s, row) => (r.weather[row] ? s + state.players[me].rowsBoard![row].length : s), 0);
    const oppRaw = ROW_KINDS.reduce((s, row) => (r.weather[row] ? s + state.players[opp].rowsBoard![row].length : s), 0);
    if (myRaw > oppRaw) return play(clear);
  }

  // A horn on our strongest unhorned row, once it's worth doubling.
  const horn = p.hand.find((c) => c.def.rows?.special === 'horn');
  if (horn) {
    const best = [...ROW_KINDS]
      .filter((row) => !p.rowsBoard!.horns[row])
      .sort((a, b) => rowPower(state, me, b) - rowPower(state, me, a))[0];
    if (best && rowPower(state, me, best) >= 10) return play(horn, best);
  }

  // Musters flood the board for one card.
  const muster = unitCards.find((c) => c.def.rows?.ability === 'muster');
  if (muster) return play(muster, unitRow(muster));

  if (unitCards.length > 0) return play(unitCards[0], unitRow(unitCards[0]));
  return { type: 'pass', player: me };
}
