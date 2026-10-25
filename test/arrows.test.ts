import { describe, expect, it } from 'vitest';
import type { PositionEval } from '../src/classify/classify.ts';
import { arrowPoints, badgeCentre, squareCentre } from '../src/content/overlay.ts';
import type { GradedMove } from '../src/review/review.ts';
import { boardMarks } from '../src/sidepanel/arrows.ts';
import type { View } from '../src/sidepanel/session.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const position = (fen: string, ...pvs: string[]): PositionEval => ({ fen, lines: pvs.map((m) => ({ score: { cp: 0 }, pv: [m] })) });
const graded = (ply: number, label: GradedMove['label'], san: string): GradedMove => ({
  ply,
  san,
  side: ply % 2 ? 'b' : 'w',
  label,
  drop: 0,
  accuracy: 100,
});
const ALL = { arrows: true, badges: true };
const arrowsOf = (v: View) => boardMarks(v, ALL).arrows;

/** A view with the board at `ply`, its lines the review's, as the Session gives them before the live search goes deeper. */
function view(ply: number | null, moves: GradedMove[], positions: PositionEval[], pasted = false): View {
  const p = ply === null ? undefined : positions[ply];
  return {
    notice: null,
    canPaste: true,
    target: { game: { sans: [] }, white: null, black: null, result: null, pasted },
    moves,
    positions,
    status: 'done',
    held: false,
    ply,
    current: ply,
    suggestion: p ? { fen: p.fen, depth: 16, lines: p.lines, searching: false } : null,
  };
}

describe('arrows (BRD-1)', () => {
  const positions = [position(START, 'e2e4', 'd2d4'), position(AFTER_E4, 'e7e5', 'c7c5'), position('', 'g1f3', 'b1c3')];
  const opening = (label: GradedMove['label']) => [graded(0, 'book', 'e4'), graded(1, label, 'a6')];

  it("shows what was better than a mistake, and the best and second-best moves now", () => {
    expect(arrowsOf(view(2, opening('mistake'), positions))).toEqual([
      { from: 'e7', to: 'e5', kind: 'better' },
      { from: 'g1', to: 'f3', kind: 'best' },
      { from: 'b1', to: 'c3', kind: 'second' },
    ]);
  });

  it.each(['book', 'brilliant', 'great', 'best', 'excellent'] as const)('has no "better" arrow after a %s move', (label) => {
    expect(arrowsOf(view(2, opening(label), positions)).map((a) => a.kind)).toEqual(['best', 'second']);
  });

  it('follows the live lines, up to three (SUG-2)', () => {
    const live = position('', 'g1f3', 'b1c3', 'f1c4').lines;
    const v = { ...view(2, opening('mistake'), positions), suggestion: { fen: '', depth: 20, lines: live, searching: true } };
    expect(arrowsOf(v)).toEqual([
      { from: 'e7', to: 'e5', kind: 'better' },
      { from: 'g1', to: 'f3', kind: 'best' },
      { from: 'b1', to: 'c3', kind: 'second' },
      { from: 'f1', to: 'c4', kind: 'third' },
    ]);
  });

  it('waits for positions the review has not reached', () => {
    expect(arrowsOf(view(2, opening('blunder'), positions.slice(0, 2))).map((a) => a.kind)).toEqual(['better']);
  });

  it('draws the king for castling and the pawn for a promotion', () => {
    expect(arrowsOf(view(0, [], [position('', 'e1g1', 'e7e8q')]))).toEqual([
      { from: 'e1', to: 'g1', kind: 'best' },
      { from: 'e7', to: 'e8', kind: 'second' },
    ]);
  });

  it('draws nothing on a side line, a pasted game, or before a game is shown', () => {
    expect(boardMarks(view(null, [], positions), ALL)).toEqual({ arrows: [], badge: null });
    expect(boardMarks(view(1, opening('blunder'), positions, true), ALL)).toEqual({ arrows: [], badge: null });
    expect(boardMarks({ ...view(1, [], positions), target: null }, ALL)).toEqual({ arrows: [], badge: null });
  });
});

describe('badges (BRD-3)', () => {
  const positions = [position(START, 'e2e4'), position(AFTER_E4, 'e7e5'), position('', 'g1f3')];

  it("puts the label's symbol on the square the move went to", () => {
    expect(boardMarks(view(1, [graded(0, 'blunder', 'e4')], positions), ALL).badge).toEqual({
      square: 'e4',
      text: '??',
      color: '#dc3b3b',
    });
    expect(boardMarks(view(2, [graded(0, 'book', 'e4'), graded(1, 'brilliant', 'Nf6')], positions), ALL).badge).toMatchObject({
      square: 'f6',
      text: '!!',
    });
  });

  it.each(['book', 'best', 'excellent', 'good'] as const)('has no badge for a %s move', (label) => {
    expect(boardMarks(view(1, [graded(0, label, 'e4')], positions), ALL).badge).toBeNull();
  });

  it('turns arrows and badges off separately (BRD-4)', () => {
    const v = view(1, [graded(0, 'blunder', 'e4')], positions);
    expect(boardMarks(v, { arrows: false, badges: true })).toMatchObject({ arrows: [], badge: { text: '??' } });
    expect(boardMarks(v, { arrows: true, badges: false }).badge).toBeNull();
  });
});

describe('arrow geometry (BRD-2)', () => {
  it('puts squares where the board shows them, in both orientations', () => {
    expect(squareCentre('a1', false)).toEqual([0.5, 7.5]);
    expect(squareCentre('h8', false)).toEqual([7.5, 0.5]);
    expect(squareCentre('a1', true)).toEqual([7.5, 0.5]);
    expect(squareCentre('e4', true)).toEqual([3.5, 3.5]);
  });

  it("puts a badge on the square's top-right corner as the board shows it", () => {
    expect(badgeCentre('e4', false)).toEqual([4.88, 4.12]);
    expect(badgeCentre('e4', true)).toEqual([3.88, 3.12]);
  });

  it('points the arrow at the target square and keeps it the given width', () => {
    const points = arrowPoints('e2', 'e4', false, 0.2);
    expect(points[3]).toEqual([4.5, 4.5]);
    expect(Math.abs(points[0][0] - points[6][0])).toBeCloseTo(0.2);
  });
});
