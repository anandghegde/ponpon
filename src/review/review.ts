// The review pipeline (REV-1, REV-4, REV-6): evaluates P0…Pn in game order and grades each move as soon as the
// position after it is done, so labels stream in.
import { Chess, type Color } from 'chess.js';
import { inBook, openingName } from '../classify/book.ts';
import {
  cappedWinPercent,
  gradeMove,
  povScore,
  type Grade,
  type Label,
  type Line,
  type PositionEval,
} from '../classify/classify.ts';
import { GAME_ACCURACY } from '../classify/thresholds.ts';
import { positionCommand, type Uci } from '../engine/uci.ts';

/** ENG-4 depths, fixed by M0's timings (docs/perf.md). */
export const PRESETS = { fast: 12, normal: 16, deep: 18 } as const;
export type Preset = keyof typeof PRESETS;
/** Bhale! needs the second-best line (CLS-2). */
export const REVIEW_MULTIPV = 2;

export interface Game {
  sans: string[];
  startFen?: string;
}

export interface GradedMove extends Grade {
  /** The move leads from positions[ply] to positions[ply + 1]. */
  ply: number;
  san: string;
  side: Color;
}

export interface Review {
  /** P0…Pn. */
  positions: PositionEval[];
  moves: GradedMove[];
}

export interface ReviewOptions {
  depth: number;
  /** Called for each move, in game order, as soon as it is graded, with the positions evaluated so far. */
  onMove?: (move: GradedMove, positions: readonly PositionEval[]) => void;
  /** Called for each position as soon as it is evaluated: `focus` and the one before it first, then P0…Pn. */
  onPosition?: (index: number, position: PositionEval) => void;
  /** The position on the board: evaluated first, with the one before it, so its arrows show at once (BRD-1). */
  focus?: number;
  /** Aborting stops the search in progress, and review() rejects with the signal's reason. */
  signal?: AbortSignal;
  /**
   * Positions already evaluated at the same depth, by FEN. review() adds every position it finishes, so a review
   * that was cancelled, or a game that grew by a move, picks up where it stopped. When every position is here, the
   * engine isn't used.
   */
  cache?: Map<string, PositionEval>;
}

export interface Summary {
  opening: string | null;
  /** REV-6: Lichess's game accuracy; null when a side has no moves. */
  accuracy: Record<Color, number | null>;
  counts: Record<Color, Partial<Record<Label, number>>>;
}

/** Throws when a SAN move doesn't parse (SRC-3: the caller then asks for the PGN). */
export async function review(uci: Uci, game: Game, opts: ReviewOptions): Promise<Review> {
  const { depth, onMove, onPosition, focus, signal, cache = new Map() } = opts;
  const chess = new Chess(game.startFen);
  const fens = [chess.fen()];
  const played = game.sans.map((san) => {
    const move = chess.move(san);
    fens.push(move.after);
    return move;
  });
  // Only the last position can end the game. The replayed history lets chess.js see a threefold repetition.
  const end = chess.isCheckmate() ? 'checkmate' : chess.isDraw() ? 'draw' : undefined;
  const cached = fens.every((fen, i) => cache.has(fen) || (i === fens.length - 1 && end));

  const stop = () => uci.send('stop');
  signal?.addEventListener('abort', stop);
  try {
    // A stored game has every position cached: it is graded again without touching the engine.
    if (!cached) {
      uci.send(`setoption name MultiPV value ${REVIEW_MULTIPV}`);
      uci.send('ucinewgame');
      await uci.isReady();
    }
    const at = async (i: number): Promise<PositionEval> =>
      i === fens.length - 1 && end
        ? { fen: fens[i], lines: [], end }
        : evaluate(uci, fens[i], positionCommand(fens[0], played.slice(0, i).map((m) => m.lan)), depth, cache, signal);
    for (const i of focus === undefined ? [] : [focus, focus - 1]) {
      if (i >= 0 && i < fens.length) onPosition?.(i, await at(i));
    }
    const positions: PositionEval[] = [];
    const moves: GradedMove[] = [];
    let book = true;
    for (let i = 0; i < fens.length; i++) {
      signal?.throwIfAborted();
      positions.push(await at(i));
      onPosition?.(i, positions[i]);
      if (i === 0) continue;
      const move = played[i - 1];
      book &&= inBook(fens[i]);
      const grade = gradeMove(positions[i - 1], positions[i], move, played[i - 2], book, moves[i - 2]?.label);
      // A book move that walks into a trap ends the book (every earlier move must be book).
      book = grade.label === 'book';
      moves.push({ ply: i - 1, san: move.san, side: move.color, ...grade });
      onMove?.(moves[i - 1], positions);
    }
    return { positions, moves };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

async function evaluate(
  uci: Uci,
  fen: string,
  position: string,
  depth: number,
  cache: Map<string, PositionEval>,
  signal: AbortSignal | undefined,
): Promise<PositionEval> {
  const cached = cache.get(fen);
  if (cached) return cached;
  const side = fen.split(' ')[1] as Color;
  const lines: Line[] = [];
  uci.send(position);
  await uci.go(`depth ${depth}`, (info) => {
    if (!info.bound) lines[info.multipv - 1] = { score: povScore(info.score, side), pv: info.pv };
  });
  // A stopped search is incomplete; keep it out of the cache.
  signal?.throwIfAborted();
  const result = { fen, lines, depth };
  cache.set(fen, result);
  return result;
}

export function summarise(r: Review): Summary {
  let opening: string | null = null;
  for (const m of r.moves) {
    if (m.label !== 'book') break;
    opening = openingName(r.positions[m.ply + 1].fen) ?? opening;
  }
  const counts: Summary['counts'] = { w: {}, b: {} };
  for (const m of r.moves) counts[m.side][m.label] = (counts[m.side][m.label] ?? 0) + 1;
  return { opening, accuracy: gameAccuracy(r), counts };
}

/**
 * REV-6, lila's AccuracyPercent.gameAccuracy: each move's accuracy is weighted by how much White's Win% swings around
 * it, and the weighted mean is averaged with the harmonic mean. Book moves count, as on Lichess.
 */
function gameAccuracy(r: Review): Summary['accuracy'] {
  const wins = r.positions.map(cappedWinPercent);
  const { window, weight } = GAME_ACCURACY;
  const size = Math.min(window.max, Math.max(window.min, Math.floor(r.moves.length / 10)));
  // One window per move, ending on the position after it; the first few moves share the first window.
  const weights = r.moves.map((_, i) => {
    const start = Math.max(0, i + 2 - size);
    return Math.min(weight.max, Math.max(weight.min, deviation(wins.slice(start, start + size))));
  });
  const side = (color: Color) => {
    const moves = r.moves.flatMap((m, i) => (m.side === color ? [{ accuracy: m.accuracy, weight: weights[i] }] : []));
    if (!moves.length) return null;
    const weighted = sum(moves.map((m) => m.accuracy * m.weight)) / sum(moves.map((m) => m.weight));
    const harmonic = moves.length / sum(moves.map((m) => 1 / Math.max(1, m.accuracy)));
    return (weighted + harmonic) / 2;
  };
  return { w: side('w'), b: side('b') };
}

/** The population standard deviation. */
function deviation(xs: number[]): number {
  const mean = sum(xs) / xs.length;
  return Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / xs.length);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
