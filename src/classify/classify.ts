// Move classification (PRD §6.4, CLS-1/2): Win% from the engine's evals, the drop Δ, and the first label whose rule matches.
import { Chess, type Color, type Move } from 'chess.js';
import type { Score } from '../engine/uci.ts';
import { ACCURACY, BOOK_MAX_DROP, BRILLIANT, DROP, GREAT, MISS_MIN_DROP, PIECE_VALUES, WIN_SLOPE } from './thresholds.ts';

export type Label =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

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
  miss: 'Miss',
  blunder: 'Blunder',
};

/** SET-1's other two label sets (PRD §6.4, Appendix A). */
export const LABEL_KANGLISH: Record<Label, string> = {
  book: 'Pustaka',
  brilliant: 'Pon!',
  great: 'Bhale!',
  best: 'Sakkath',
  excellent: 'Chessnagide',
  good: 'Sari',
  inaccuracy: 'Swalpa',
  mistake: 'Tappu',
  miss: 'Kai Jaaritu',
  blunder: 'Ayyo',
};

export const LABEL_KANNADA: Record<Label, string> = {
  book: 'ಪುಸ್ತಕ',
  brilliant: 'ಪೊನ್',
  great: 'ಭಲೇ',
  best: 'ಸಖತ್',
  excellent: 'ಚೆಸ್ನಾಗಿದೆ',
  good: 'ಸರಿ',
  inaccuracy: 'ಸ್ವಲ್ಪ',
  mistake: 'ತಪ್ಪು',
  miss: 'ಕೈ ಜಾರಿತು',
  blunder: 'ಅಯ್ಯೋ',
};

/** What each Kanglish word means (Appendix A). */
export const KANGLISH_MEANINGS: Record<Label, string> = {
  book: '“book”',
  brilliant: '“gold”',
  great: '“bravo”',
  best: '“awesome”',
  excellent: '“it’s good”, with chess inside',
  good: '“okay, correct”',
  inaccuracy: '“a little”',
  mistake: '“mistake”',
  miss: '“slipped from the hand”',
  blunder: '“oh no”',
};

/** Annotation symbols, shown after the move in the panel and in the board's badge (BRD-3). */
export const LABEL_SYMBOLS: Partial<Record<Label, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  miss: '×',
  blunder: '??',
};

/** PRD §6.4's colours; the side panel's stylesheet repeats them. */
export const LABEL_COLORS: Record<Label, string> = {
  book: '#a0703c',
  brilliant: '#d4a017',
  great: '#179c9c',
  best: '#3f9b3f',
  excellent: '#7ac35f',
  good: '#8aa58a',
  inaccuracy: '#e1b81f',
  mistake: '#ee8a2a',
  miss: '#e0679a',
  blunder: '#dc3b3b',
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
  /** The depth the lines were searched to. */
  depth?: number;
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
  /** The opponent's previous move was Tappu, Ayyo or itself a Kai Jaaritu (CLS-3). */
  opponentErred: boolean;
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

/** Lichess's move accuracy for a drop in capped Win% (cappedWinPercent). */
export function moveAccuracy(drop: number): number {
  if (drop <= 0) return 100;
  return Math.min(100, Math.max(0, ACCURACY.a * Math.exp(-ACCURACY.b * drop) - ACCURACY.c + ACCURACY.bonus));
}

/** White's Win% as Lichess counts it for accuracy: evaluations capped at ±10 pawns, and a mate counts as 10 pawns. */
export function cappedWinPercent(p: PositionEval): number {
  if (p.end === 'draw') return 50;
  const score = p.end ? { mate: p.fen.split(' ')[1] === 'w' ? -1 : 1 } : p.lines[0].score;
  const cp = 'mate' in score ? Math.sign(score.mate) * ACCURACY.cpCeiling : score.cp;
  return winPercent({ cp: Math.max(-ACCURACY.cpCeiling, Math.min(ACCURACY.cpCeiling, cp)) });
}

/** The §6.4 rules, checked in order. */
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
  // The engine's own move isn't a miss, whatever a deeper look at P′ says.
  if (f.opponentErred && drop >= MISS_MIN_DROP && !f.isBest) return 'miss';
  if (f.isBest || drop < DROP.best || f.legalMoves === 1) return 'best';
  if (drop < DROP.excellent) return 'excellent';
  if (drop < DROP.good) return 'good';
  if (drop < DROP.inaccuracy) return 'inaccuracy';
  if (drop < DROP.mistake) return 'mistake';
  return 'blunder';
}

/** Labels that a Kai Jaaritu fails to punish. */
const ERRORS: ReadonlySet<Label> = new Set(['mistake', 'miss', 'blunder']);

/** Grades `played`, the move from `before` to `after`. `prev` is the move just before it, if any, labelled `prevLabel`. */
export function gradeMove(
  before: PositionEval,
  after: PositionEval,
  played: Move,
  prev: Move | undefined,
  book: boolean,
  prevLabel?: Label,
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
    opponentErred: prevLabel !== undefined && ERRORS.has(prevLabel),
    materialLoss:
      Math.min(material(before.fen, [], side), material(before.fen, other, side)) - material(after.fen, reply, side),
  });
  const drop = Math.max(0, winBefore - winAfter);
  const pov = (white: number) => (side === 'w' ? white : 100 - white);
  return { label, drop, accuracy: moveAccuracy(pov(cappedWinPercent(before)) - pov(cappedWinPercent(after))) };
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
