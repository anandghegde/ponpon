// The review pipeline (REV-1, REV-4, REV-5): evaluates P0…Pn in game order and grades each move as soon as the
// position after it is done, so labels stream in.
import { Chess, type Color } from 'chess.js';
import { inBook, openingName } from '../classify/book.ts';
import { gradeMove, povScore, type Grade, type Label, type Line, type PositionEval } from '../classify/classify.ts';
import type { Uci } from '../engine/uci.ts';

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
  /** REV-5: the mean move accuracy, book moves excluded; null when a side has no graded moves. */
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
      i === fens.length - 1 && end ? { fen: fens[i], lines: [], end } : evaluate(uci, fens[i], depth, cache, signal);
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
      const grade = gradeMove(positions[i - 1], positions[i], move, played[i - 2], book);
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
  depth: number,
  cache: Map<string, PositionEval>,
  signal: AbortSignal | undefined,
): Promise<PositionEval> {
  const cached = cache.get(fen);
  if (cached) return cached;
  const side = fen.split(' ')[1] as Color;
  const lines: Line[] = [];
  uci.send(`position fen ${fen}`);
  await uci.go(`depth ${depth}`, (info) => {
    if (!info.bound) lines[info.multipv - 1] = { score: povScore(info.score, side), pv: info.pv };
  });
  // A stopped search is incomplete; keep it out of the cache.
  signal?.throwIfAborted();
  const result = { fen, lines };
  cache.set(fen, result);
  return result;
}

export function summarise(r: Review): Summary {
  let opening: string | null = null;
  for (const m of r.moves) {
    if (m.label !== 'book') break;
    opening = openingName(r.positions[m.ply + 1].fen) ?? opening;
  }
  const accuracy = (side: Color) => {
    const graded = r.moves.filter((m) => m.side === side && m.label !== 'book');
    return graded.length ? graded.reduce((sum, m) => sum + m.accuracy, 0) / graded.length : null;
  };
  const counts: Summary['counts'] = { w: {}, b: {} };
  for (const m of r.moves) counts[m.side][m.label] = (counts[m.side][m.label] ?? 0) + 1;
  return { opening, accuracy: { w: accuracy('w'), b: accuracy('b') }, counts };
}
