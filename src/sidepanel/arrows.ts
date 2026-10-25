// What the board shows (BRD-1, BRD-3, REV-3's "show on board"): for the position on chess.com's board, the engine's
// best moves (up to three); when the move that led there was Good or worse, the move that was better; and that move's
// label as a badge on its square. The best moves follow the panel's lines: the review's once it has reached the
// position, then the live search's as it goes deeper (SUG-2).
import { Chess } from 'chess.js';
import { LABEL_COLORS, LABEL_SYMBOLS, type Label } from '../classify/classify.ts';
import type { Arrow, Marks } from '../content/overlay.ts';
import type { View } from './session.ts';

/** Labels whose move gets a "should have played" arrow. */
const WORSE: ReadonlySet<Label> = new Set(['good', 'inaccuracy', 'mistake', 'miss', 'blunder']);

export function boardMarks(view: View, show: { arrows: boolean; badges: boolean }): Marks {
  const { ply, positions, moves } = view;
  if (ply === null || !view.target || view.target.pasted) return { arrows: [], badge: null };
  const arrows: Arrow[] = [];
  const last = ply > 0 ? moves[ply - 1] : undefined;
  const before = positions[ply - 1];
  const better = before?.lines[0]?.pv[0];
  if (last && better && WORSE.has(last.label)) arrows.push({ ...squares(better), kind: 'better' });
  const [best, second, third] = view.suggestion?.lines ?? [];
  if (best?.pv[0]) arrows.push({ ...squares(best.pv[0]), kind: 'best' });
  if (second?.pv[0]) arrows.push({ ...squares(second.pv[0]), kind: 'second' });
  if (third?.pv[0]) arrows.push({ ...squares(third.pv[0]), kind: 'third' });
  const symbol = last && LABEL_SYMBOLS[last.label];
  const badge =
    last && before && symbol
      ? { square: new Chess(before.fen).move(last.san).to, text: symbol, color: LABEL_COLORS[last.label] }
      : null;
  return { arrows: show.arrows ? arrows : [], badge: show.badges ? badge : null };
}

/** `e7e8q` → e7, e8. Castling is the king's move (`e1g1`). */
function squares(uci: string): { from: string; to: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}
