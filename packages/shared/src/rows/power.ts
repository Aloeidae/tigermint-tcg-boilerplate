import type { GameState, PlayerId } from '../types.js';
import type { RowKind, RowsBoard, RowsUnit } from './types.js';
import { ROW_KINDS } from './types.js';

/**
 * Effective power of one unit, on the board side of `owner` (spies stand on
 * the OPPONENT's side, so owner is the side it scores for, not who played it).
 * Order: weather flattens to 1 → bond multiplies → horn doubles. Heroes
 * ignore all of it.
 */
export function unitPower(state: GameState, owner: PlayerId, rowKind: RowKind, unit: RowsUnit): number {
  const block = unit.def.rows;
  if (!block || block.kind !== 'unit') return 0;
  const base = block.power ?? 0;
  if (block.hero) return base;

  let p = state.rowsRound?.weather[rowKind] ? Math.min(base, 1) : base;

  const board = state.players[owner].rowsBoard;
  const row = board ? board[rowKind] : [];
  if (block.ability === 'bond') {
    const copies = row.filter((u) => u.def.id === unit.def.id).length;
    if (copies > 1) p *= copies;
  }
  const horned =
    (board?.horns[rowKind] ?? false) ||
    row.some((u) => u.instanceId !== unit.instanceId && u.def.rows?.ability === 'horn');
  if (horned) p *= 2;
  return p;
}

export function rowPower(state: GameState, owner: PlayerId, rowKind: RowKind): number {
  const board = state.players[owner].rowsBoard;
  if (!board) return 0;
  return board[rowKind].reduce((sum, u) => sum + unitPower(state, owner, rowKind, u), 0);
}

export function totalPower(state: GameState, owner: PlayerId): number {
  return ROW_KINDS.reduce((sum, r) => sum + rowPower(state, owner, r), 0);
}

/** Every unit in play, with the side it scores for and its effective power. */
export function unitsInPlay(state: GameState): { owner: PlayerId; row: RowKind; unit: RowsUnit; power: number }[] {
  const out: { owner: PlayerId; row: RowKind; unit: RowsUnit; power: number }[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const board: RowsBoard | undefined = state.players[owner].rowsBoard;
    if (!board) continue;
    for (const row of ROW_KINDS) {
      for (const unit of board[row]) {
        out.push({ owner, row, unit, power: unitPower(state, owner, row, unit) });
      }
    }
  }
  return out;
}
