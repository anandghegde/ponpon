import { describe, expect, it } from 'vitest';
import type { PositionEval } from '../src/classify/classify.ts';
import { arrowPoints, squareCentre } from '../src/content/overlay.ts';
import type { GradedMove } from '../src/review/review.ts';
import { boardArrows } from '../src/sidepanel/arrows.ts';
import type { View } from '../src/sidepanel/session.ts';

const position = (...pvs: string[]): PositionEval => ({ fen: '', lines: pvs.map((m) => ({ score: { cp: 0 }, pv: [m] })) });
const graded = (ply: number, label: GradedMove['label']): GradedMove => ({ ply, san: '', side: ply % 2 ? 'b' : 'w', label, drop: 0, accuracy: 100 });

function view(ply: number | null, moves: GradedMove[], positions: PositionEval[], pasted = false): View {
  return {
    notice: null,
    canPaste: true,
    target: { game: { sans: [] }, white: null, black: null, result: null, pasted },
    moves,
    positions,
    status: 'done',
    held: false,
    ply,
  };
}

describe('boardArrows (BRD-1)', () => {
  const positions = [position('e2e4', 'd2d4'), position('e7e5', 'c7c5'), position('g1f3', 'b1c3')];

  it("shows what was better than a mistake, and the best and second-best moves now", () => {
    expect(boardArrows(view(2, [graded(0, 'book'), graded(1, 'mistake')], positions))).toEqual([
      { from: 'e7', to: 'e5', kind: 'better' },
      { from: 'g1', to: 'f3', kind: 'best' },
      { from: 'b1', to: 'c3', kind: 'second' },
    ]);
  });

  it.each(['book', 'brilliant', 'great', 'best', 'excellent'] as const)('has no "better" arrow after a %s move', (label) => {
    expect(boardArrows(view(2, [graded(0, 'book'), graded(1, label)], positions)).map((a) => a.kind)).toEqual(['best', 'second']);
  });

  it('waits for positions the review has not reached', () => {
    expect(boardArrows(view(2, [graded(0, 'book'), graded(1, 'blunder')], positions.slice(0, 2))).map((a) => a.kind)).toEqual([
      'better',
    ]);
  });

  it('draws the king for castling and the pawn for a promotion', () => {
    expect(boardArrows(view(0, [], [position('e1g1', 'e7e8q')]))).toEqual([
      { from: 'e1', to: 'g1', kind: 'best' },
      { from: 'e7', to: 'e8', kind: 'second' },
    ]);
  });

  it('draws nothing on a side line, a pasted game, or before a game is shown', () => {
    expect(boardArrows(view(null, [], positions))).toEqual([]);
    expect(boardArrows(view(1, [], positions, true))).toEqual([]);
    expect(boardArrows({ ...view(1, [], positions), target: null })).toEqual([]);
  });
});

describe('arrow geometry (BRD-2)', () => {
  it('puts squares where the board shows them, in both orientations', () => {
    expect(squareCentre('a1', false)).toEqual([0.5, 7.5]);
    expect(squareCentre('h8', false)).toEqual([7.5, 0.5]);
    expect(squareCentre('a1', true)).toEqual([7.5, 0.5]);
    expect(squareCentre('e4', true)).toEqual([3.5, 3.5]);
  });

  it('points the arrow at the target square and keeps it the given width', () => {
    const points = arrowPoints('e2', 'e4', false, 0.2);
    expect(points[3]).toEqual([4.5, 4.5]);
    expect(Math.abs(points[0][0] - points[6][0])).toBeCloseTo(0.2);
  });
});
