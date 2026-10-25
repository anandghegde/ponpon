// Next-move suggestions (SUG-1, SUG-2): `go infinite` with MultiPV on one position. Each complete iteration (every
// line at the same depth) is reported as it arrives, until depth 22 is complete or 15 s have passed.
import { Chess } from 'chess.js';
import { povScore, type Line } from '../classify/classify.ts';
import { positionCommand, type Uci } from '../engine/uci.ts';
import type { Game } from '../review/review.ts';

/** SUG-2: the search stops once this depth is complete for every line… */
export const SUGGEST_DEPTH = 22;
/** …or after this long. */
export const SUGGEST_MS = 15000;

export interface Suggestion {
  depth: number;
  /** Best first, from White's point of view (ENG-3). */
  lines: Line[];
}

export interface SuggestOptions {
  /** SUG-1: how many lines (1–3). Fewer when the position has fewer legal moves. */
  multipv: number;
  /** Called with each complete iteration, deeper each time. */
  onLines?: (s: Suggestion) => void;
  /** Aborting stops the search, and suggest() rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * Searches the position after `ply` moves of `game`, the moves included so the engine sees repetitions. Resolves with
 * the deepest complete iteration once the search stops. The position must have a legal move.
 */
export async function suggest(uci: Uci, game: Game, ply: number, opts: SuggestOptions): Promise<Suggestion> {
  const { multipv, onLines, signal } = opts;
  const chess = new Chess(game.startFen);
  const start = chess.fen();
  for (const san of game.sans.slice(0, ply)) chess.move(san);
  const n = Math.min(multipv, chess.moves().length);
  const side = chess.turn();
  let deepest: Suggestion = { depth: 0, lines: [] };
  let depth = 0;
  let lines: Line[] = [];
  let stopped = false;
  const stop = () => {
    if (!stopped) uci.send('stop');
    stopped = true;
  };
  const timer = setTimeout(stop, SUGGEST_MS);
  signal?.addEventListener('abort', stop);
  try {
    uci.send(`setoption name MultiPV value ${multipv}`);
    uci.send(positionCommand(start, chess.history({ verbose: true }).map((m) => m.lan)));
    await uci.go('infinite', (info) => {
      // Lines printed after `stop` come from an iteration cut short.
      if (info.bound || stopped) return;
      // Stockfish prints lines it hasn't searched again yet at the previous depth: an iteration is complete once
      // every line has the same depth.
      if (info.depth !== depth) [depth, lines] = [info.depth, []];
      lines[info.multipv - 1] = { score: povScore(info.score, side), pv: info.pv };
      if (lines.filter(Boolean).length < n) return;
      deepest = { depth, lines: lines.slice(0, n) };
      onLines?.(deepest);
      if (depth >= SUGGEST_DEPTH) stop();
    });
    signal?.throwIfAborted();
    return deepest;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
