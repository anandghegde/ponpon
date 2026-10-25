// CLS-5: positions with a hand-checked label each. The last move of each case is graded; the move before it is the
// opponent's (it matters for the recapture rule). The engine's output is recorded in GOLDEN_EVALS by
// `npm run record:golden`, so the test runs without the engine.
import type { Label } from '../src/classify/classify.ts';

export interface GoldenCase {
  name: string;
  /** The start position; the standard one when left out. Constructed positions drop a pawn pair to stay out of the book. */
  fen?: string;
  /** SAN; the last move is graded. */
  moves: string[];
  label: Label;
}

export const GOLDEN_EVALS = 'test/fixtures/golden-evals.json';

export const GOLDEN: GoldenCase[] = [
  // Book (CLS-4)
  { name: '1.e4 is book', moves: ['e4'], label: 'book' },
  { name: 'Ruy Lopez, Morphy Defence: 3…a6 is book', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], label: 'book' },
  { name: "Fool's Mate is named in the book, but 2.g4 walks into mate", moves: ['f3', 'e5', 'g4'], label: 'blunder' },
  { name: "Fool's Mate: the book ended with 2.g4; 2…Qh4# mates, but 2…h5 wins clearly too (−3.7)", moves: ['f3', 'e5', 'g4', 'Qh4#'], label: 'best' },

  // Mate for and against
  { name: "Scholar's Mate: 3…Nf6 allows mate in one", moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'], label: 'blunder' },
  { name: "Scholar's Mate: 4.Qxf7# is the only move that keeps White's edge", moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'], label: 'great' },
  { name: 'Back-rank mate, when Qe8# mates too: best, not great', fen: '6k1/5ppp/8/8/8/8/5PPP/R3Q1K1 w - - 0 1', moves: ['Ra8#'], label: 'best' },
  { name: 'K+Q v K: Qg7# when Qh1# and Qh2# mate too', fen: '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1', moves: ['Qg7#'], label: 'best' },
  { name: 'K+Q v K: Qg6 stalemates and throws the win away', fen: '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1', moves: ['Qg6'], label: 'blunder' },
  { name: 'A lost position: every king move loses, so none is a blunder', fen: '8/8/8/4k3/8/8/3QK3/8 b - - 0 1', moves: ['Kf5'], label: 'best' },
  { name: '12…Nxd4 takes a bishop and allows mate in two (Qxa7+)', fen: '1k1r1bnr/pppqp1pp/2n5/1N6/Q2p4/4B2P/PP2BP1P/R3K2R w KQ - 0 12', moves: ['Bxd4', 'Nxd4'], label: 'blunder' },

  // Only moves and recaptures (Bhale!'s guards)
  { name: 'The only legal move is best, never great', fen: 'rnb1kbnr/1pp2ppp/8/4P3/2p1P3/8/1P3PPP/RNBqKBNR w KQkq - 0 5', moves: ['Kxd1'], label: 'best' },
  { name: 'Recapturing the rook is the only move, but a recapture: best, not great', fen: 'r2r2k1/5ppp/8/8/8/8/5PPP/3RR1K1 b - - 0 1', moves: ['Rxd1', 'Rxd1'], label: 'best' },
  { name: '19.Bh4 is the only square for the bishop (Bg6 is −4.0)', fen: '2k1r2r/1ppb2pp/p1np4/6B1/5P2/2PB4/P1P3PP/R4RK1 b - - 1 18', moves: ['h6', 'Bh4'], label: 'great' },
  { name: '8…Nbd7 is the only good block of the check (8…Bd7 is +2.0)', fen: 'rn1qkb1r/pp3ppp/3p1n2/3P4/5Bb1/2N5/PPP3PP/R2QKBNR w KQkq - 1 8', moves: ['Bb5+', 'Nbd7'], label: 'great' },
  { name: '36.Kxg5 takes the rook left hanging; anything else loses', fen: '8/1p1k4/p7/3p2r1/3NRK2/8/PP5P/8 b - - 0 35', moves: ['dxe4', 'Kxg5'], label: 'great' },

  // Sacrifices (Pon!'s guards)
  { name: 'Desperado: 1.Rd8+ gives the rook, and …Kxd8 is forced and stalemates; a lost game saved', fen: '2k5/ppp5/8/8/6p1/6Pp/5q1P/3R3K w - - 0 1', moves: ['Rd8+'], label: 'brilliant' },
  { name: 'Greek gift: the engine declines Bxh7+ with …Kh8, so no sacrifice; the only winning move', fen: 'rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7', moves: ['Bxh7+'], label: 'great' },
  { name: 'Fake sacrifice: Bxh7+ uncovers the rook on the queen and wins more back at once', fen: '2bq1rk1/pp3ppp/2p5/8/8/3B4/PPP1QPPP/3R2K1 w - - 0 1', moves: ['Bxh7+'], label: 'great' },
  { name: 'The bishop on a1 is lost whatever Black plays, so 17…Kc7 is no sacrifice; it is the best king move by 11 Win%', fen: 'r6r/pp1k2pp/8/q1pp4/P3p2P/1P2P3/2PN1PP1/b2Q1RK1 w - - 0 17', moves: ['Qg4+', 'Kc7'], label: 'great' },
  { name: '16.Qxf3 takes the knight back; gxf3 would grab more and lose, but that makes no sacrifice', fen: '2kr3r/ppp3bp/3q4/3nn3/8/2P2N2/PP2QPPP/RNB2RK1 b - - 1 15', moves: ['Nxf3+', 'Qxf3'], label: 'best' },

  // The drop bands
  { name: '25.Kc1: not the engine\'s c3, but within 1 Win%', fen: '4N3/1p1k1ppp/p4b2/3P4/5B2/1P6/1PP3PP/3K4 b - - 0 24', moves: ['Kxe8', 'Kc1'], label: 'best' },
  { name: '9.d5 closes the centre, a little behind Ngf3', fen: 'r2qkb1r/pb1npppp/1p1p1n2/8/1PBPP3/8/PB1N1PPP/R2QK1NR b KQkq - 0 8', moves: ['e5', 'd5'], label: 'excellent' },
  { name: '17.Qxf5+ wins the pawn with check; Rad1 was a touch stronger', fen: '2kr2nr/ppp3q1/8/3p1p2/8/2N2QP1/PPP2P1P/R3R1K1 b - - 3 16', moves: ['Nf6', 'Qxf5+'], label: 'excellent' },
  { name: '12…Nc5 is a bit worse than …Ne5 (+1.7 → +1.9)', fen: '2kr1b1r/pp1nqppp/3p1n2/1B1P4/5B2/3Q4/PPP1N1PP/R3K2R w KQ - 1 12', moves: ['O-O-O', 'Nc5'], label: 'good' },
  { name: '32…Ke5 lets White\'s edge grow in a lost ending', fen: '8/5p2/p2k1b2/3P2p1/1PP4p/8/2K2BPP/8 w - - 2 32', moves: ['Bc5+', 'Ke5'], label: 'good' },
  { name: '12.Nxh7 wins a pawn, but 12.Bxh7+ wins outright; White is still winning', fen: 'r1b2rk1/ppppnppp/2n1q3/4P1N1/3P4/2PB4/P4PPP/R1BQ1RK1 b - - 6 11', moves: ['Qd5', 'Nxh7'], label: 'inaccuracy' },
  { name: '6…Nc6 blocks the check but gives back part of Black\'s big edge (−4.7 → −3.3)', fen: 'rnbqkbnr/ppp1p1pp/8/3p4/2B5/7N/PPQ2PPP/RNB1K2R w KQkq - 0 6', moves: ['Qa4+', 'Nc6'], label: 'inaccuracy' },
  { name: '6.Nbc3 leaves d5 alone, and …d4 gains space with tempo (+0.1 → −1.2)', fen: 'rnbqkb1r/pppp2pp/5n2/4p3/4P3/5P2/PPP1N1PP/RNBQKB1R b KQkq - 1 5', moves: ['d5', 'Nbc3'], label: 'mistake' },
  { name: '22.f4 lets …Nb4 in; White is still winning, but +6.4 becomes +3.9', fen: '1rb1n1k1/p6p/n5pB/3P4/1qP1p3/2Q5/PP3PP1/2KR1B1R b - - 1 21', moves: ['Qb7', 'f4'], label: 'mistake' },
  { name: '17.Kc3 walks into …Rxd3+ in a lost position (−5.5 → −15)', fen: '2kr3r/ppp3pp/2n1b2n/4p1q1/2P3P1/B2B1P2/P1K1N2P/R2Q1R2 b - - 0 16', moves: ['Bxc4', 'Kc3'], label: 'mistake' },
  { name: '14.Ba4 retreats, and …b5 wins a piece (Bxa6 was +2.8)', fen: '2kr1b1r/pp2qppp/3p1n2/1BnP4/2Q2B2/8/PPP1N1PP/2KR3R b - - 4 13', moves: ['a6', 'Ba4'], label: 'blunder' },
];
