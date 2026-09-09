import type { GameState, PlayerId } from '../types.js';
import type { RowKind, RowsBoard, RowsUnit } from './types.js';
import { ROW_KINDS } from './types.js';

type Weather = { melee: boolean; ranged: boolean; siege: boolean };
const NO_WEATHER: Weather = { melee: false, ranged: false, siege: false };

/**
 * Effective power of one unit standing on `board` (spies stand on the
 * OPPONENT's board, so the board is the side it scores for, not who played
 * it). Order: weather flattens to 1 → bond multiplies → horn doubles.
 * Heroes ignore all of it. Board-level so client views can compute it too.
 */
export function boardUnitPower(board: RowsBoard, weather: Weather, rowKind: RowKind, unit: RowsUnit): number {
  const block = unit.def.rows;
  if (!block || block.kind !== 'unit') return 0;
  const base = block.power ?? 0;
  if (block.hero) return base;

  let p = weather[rowKind] ? Math.min(base, 1) : base;

  const row = board[rowKind];
  if (block.ability === 'bond') {
    const copies = row.filter((u) => u.def.id === unit.def.id).length;
    if (copies > 1) p *= copies;
  }
  const horned =
    board.horns[rowKind] ||
    row.some((u) => u.instanceId !== unit.instanceId && u.def.rows?.ability === 'horn');
  if (horned) p *= 2;
  return p;
}

export function boardRowPower(board: RowsBoard, weather: Weather, rowKind: RowKind): number {
  return board[rowKind].reduce((sum, u) => sum + boardUnitPower(board, weather, rowKind, u), 0);
}

export function boardTotalPower(board: RowsBoard, weather: Weather): number {
  return ROW_KINDS.reduce((sum, r) => sum + boardRowPower(board, weather, r), 0);
}

export function unitPower(state: GameState, owner: PlayerId, rowKind: RowKind, unit: RowsUnit): number {
  const board = state.players[owner].rowsBoard;
  if (!board) return 0;
  return boardUnitPower(board, state.rowsRound?.weather ?? NO_WEATHER, rowKind, unit);
}

export function rowPower(state: GameState, owner: PlayerId, rowKind: RowKind): number {
  const board = state.players[owner].rowsBoard;
  if (!board) return 0;
  return boardRowPower(board, state.rowsRound?.weather ?? NO_WEATHER, rowKind);
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
