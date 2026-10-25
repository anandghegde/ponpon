// Move classification (PRD §6.4, CLS-1/2): Win% from the engine's evals, the drop Δ, and the first label whose rule matches.
import { Chess, type Color, type Move } from 'chess.js';
import type { Score } from '../engine/uci.ts';
import { ACCURACY, BOOK_MAX_DROP, BRILLIANT, DROP, GREAT, PIECE_VALUES, WIN_SLOPE } from './thresholds.ts';

export type Label = 'book' | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** English names, the default label set (SET-1). */
export const LABEL_NAMES: Record<Label, string> = {
  book: 'Book',
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

export interface Line {
  /** From White's point of view (ENG-3). */
  score: Score;
  /** UCI moves. */
  pv: string[];
}

/** The engine's view of one position of a game. */
export interface PositionEval {
  fen: string;
  /** Best first. Empty when the game is over in this position. */
  lines: Line[];
  /** Set when the game is over in this position; the engine doesn't run. */
  end?: 'checkmate' | 'draw';
}

/** What the rules look at for one move. Win% is from the mover's point of view. */
export interface MoveFacts {
  book: boolean;
  /** Win% of P's best line (Wb) and of P′ (Wa). */
  winBefore: number;
  winAfter: number;
  /** Win% of P's second-best line; null when the engine gave only one. */
  winSecond: number | null;
  /** The played move is the engine's best at P. */
  isBest: boolean;
  legalMoves: number;
  /** A capture on the square where the opponent's last move captured. */
  recapture: boolean;
  /**
   * Points of material the mover is down after the first plies of P′'s best line, compared with P and with the best
   * other move at P played out as far (unless that one gets mated), whichever is less. A piece that is lost whatever
   * the mover does isn't a sacrifice, and nor is a capture that grabs less than a greedier alternative would.
   */
  materialLoss: number;
}

export interface Grade {
  label: Label;
  /** Δ, in Win% points. */
  drop: number;
  accuracy: number;
}

/** ENG-3: converts a score between White's point of view and `side`'s. The conversion is its own inverse. */
export function povScore(score: Score, side: Color): Score {
  if (side === 'w') return score;
  return 'mate' in score ? { mate: -score.mate } : { cp: -score.cp };
}

/** Lichess's Win% for a score from the mover's point of view. */
export function winPercent(score: Score): number {
  if ('mate' in score) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_SLOPE * score.cp)) - 1);
}

export function moveAccuracy(drop: number): number {
  return Math.min(100, Math.max(0, ACCURACY.a * Math.exp(-ACCURACY.b * drop) - ACCURACY.c));
}

/** The §6.4 rules, checked in order. Kai Jaaritu (Miss, CLS-3) is v1.1. */
export function classify(f: MoveFacts): Label {
  const drop = Math.max(0, f.winBefore - f.winAfter);
  if (f.book && drop < BOOK_MAX_DROP) return 'book';
  if (
    drop < BRILLIANT.maxDrop &&
    f.materialLoss >= BRILLIANT.minMaterialLoss &&
    f.winBefore <= BRILLIANT.maxWinBefore &&
    f.winAfter >= BRILLIANT.minWinAfter
  ) {
    return 'brilliant';
  }
  if (
    f.isBest &&
    f.winSecond !== null &&
    f.winBefore - f.winSecond >= GREAT.minGap &&
    f.winSecond < GREAT.maxWinSecond &&
    !f.recapture &&
    f.legalMoves > 1
  ) {
    return 'great';
  }
  if (f.isBest || drop < DROP.best || f.legalMoves === 1) return 'best';
  if (drop < DROP.excellent) return 'excellent';
  if (drop < DROP.good) return 'good';
  if (drop < DROP.inaccuracy) return 'inaccuracy';
  if (drop < DROP.mistake) return 'mistake';
  return 'blunder';
}

/** Grades `played`, the move from `before` to `after`. `prev` is the move just before it, if any. */
export function gradeMove(
  before: PositionEval,
  after: PositionEval,
  played: Move,
  prev: Move | undefined,
  book: boolean,
): Grade {
  const side = played.color;
  const [best, second] = before.lines;
  const winBefore = winPercent(povScore(best.score, side));
  const winAfter = after.end
    ? after.end === 'checkmate' ? 100 : 50
    : winPercent(povScore(after.lines[0].score, side));
  const isBest = played.lan === best.pv[0];
  const reply = after.lines[0]?.pv.slice(0, BRILLIANT.pvPlies) ?? [];
  // The best other move, played out as far, unless it gets mated: its material means nothing then.
  const alt = isBest ? second : best;
  const other = alt && winPercent(povScore(alt.score, side)) > 0 ? alt.pv.slice(0, BRILLIANT.pvPlies + 1) : [];
  const label = classify({
    book,
    winBefore,
    winAfter,
    winSecond: second ? winPercent(povScore(second.score, side)) : null,
    isBest,
    legalMoves: new Chess(before.fen).moves().length,
    recapture: prev?.captured !== undefined && played.to === prev.to,
    materialLoss:
      Math.min(material(before.fen, [], side), material(before.fen, other, side)) - material(after.fen, reply, side),
  });
  const drop = Math.max(0, winBefore - winAfter);
  return { label, drop, accuracy: moveAccuracy(drop) };
}

/** `side`'s material minus the opponent's, after playing the UCI moves from `fen`. */
function material(fen: string, moves: string[], side: Color): number {
  const chess = new Chess(fen);
  for (const m of moves) chess.move(m);
  let sum = 0;
  for (const row of chess.board()) {
    for (const p of row) if (p) sum += (p.color === side ? 1 : -1) * PIECE_VALUES[p.type];
  }
  return sum;
}
