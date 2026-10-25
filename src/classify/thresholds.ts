// Every number the move classifier uses (PRD §6.4). Win% values run 0–100, from the mover's point of view.

/** Lichess's centipawn → Win% slope. */
export const WIN_SLOPE = 0.00368208;

/**
 * Lichess's move accuracy: clamp(A × exp(−B × Δ) − C + bonus, 0, 100), 100 for a move that loses nothing. Δ here comes
 * from evaluations capped at ±cpCeiling centipawns, a mate counting as the ceiling (lila's AccuracyPercent).
 */
export const ACCURACY = { a: 103.1668, b: 0.04354, c: 3.1669, bonus: 1, cpCeiling: 1000 };

/**
 * REV-6, Lichess's game accuracy: each move is weighted by the standard deviation of White's Win% over a window of
 * positions around it (moves ÷ 10 positions, within `window`), the weight kept within `weight`.
 */
export const GAME_ACCURACY = { window: { min: 2, max: 8 }, weight: { min: 0.5, max: 12 } };

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;

/**
 * Pustaka (Book) stops short of a mistake. Lichess's book names a few traps (Barnes Opening: Fool's Mate), and the
 * blunder that walks into one isn't theory.
 */
export const BOOK_MAX_DROP = 10;

/** Pon! (Brilliant): a sound sacrifice that is the best or nearly the best move. */
export const BRILLIANT = {
  maxDrop: 2,
  /** Plies of the engine's line from P′ that are played out before material is counted. */
  pvPlies: 4,
  /** Points the mover must be down after those plies, compared with P and with the best other move played out as far. */
  minMaterialLoss: 2,
  /** Not already won before the move. */
  maxWinBefore: 90,
  /** Still sound after it. */
  minWinAfter: 50,
};

/** Bhale! (Great): the only move that holds. */
export const GREAT = {
  /** The second-best move at P is at least this much Win% worse. */
  minGap: 10,
  /** The second-best move must not still win clearly (75 ≈ +3), so a mate isn't Great when other moves win too. */
  maxWinSecond: 75,
};

/** Kai Jaaritu (Miss): the opponent's mistake went unpunished, the drop at least this much (CLS-3). */
export const MISS_MIN_DROP = 10;

/** Upper bounds on the drop Δ for each label; Ayyo (Blunder) is everything from `mistake` up. */
export const DROP = { best: 1, excellent: 2, good: 5, inaccuracy: 10, mistake: 15 };
