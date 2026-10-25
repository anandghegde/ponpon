// Which arrows the board shows (BRD-1, REV-3's "show on board"): for the position on chess.com's board, the engine's
// best and second-best moves, and, when the move that led there was Good or worse, the move that was better.
// They come from the review's MultiPV 2 lines, so a position shows arrows once the review has reached it.
import type { Label } from '../classify/classify.ts';
import type { Arrow } from '../content/overlay.ts';
import type { View } from './session.ts';

/** Labels whose move gets a "should have played" arrow. */
const WORSE: ReadonlySet<Label> = new Set(['good', 'inaccuracy', 'mistake', 'blunder']);

export function boardArrows(view: View): Arrow[] {
  const { ply, positions, moves } = view;
  if (ply === null || !view.target || view.target.pasted) return [];
  const arrows: Arrow[] = [];
  const last = ply > 0 ? moves[ply - 1] : undefined;
  const better = positions[ply - 1]?.lines[0]?.pv[0];
  if (last && better && WORSE.has(last.label)) arrows.push({ ...squares(better), kind: 'better' });
  const [best, second] = positions[ply]?.lines ?? [];
  if (best?.pv[0]) arrows.push({ ...squares(best.pv[0]), kind: 'best' });
  if (second?.pv[0]) arrows.push({ ...squares(second.pv[0]), kind: 'second' });
  return arrows;
}

/** `e7e8q` → e7, e8. Castling is the king's move (`e1g1`). */
function squares(uci: string): { from: string; to: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}
