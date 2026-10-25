// Renders a Session view: the notice, the summary card (REV-4), the move list with label badges (REV-2), the
// selected-move card (REV-3) and the paste box (SRC-4). Plain DOM, rebuilt on every view; text only, never HTML,
// since player names come from the page or a pasted PGN.
import { LABEL_NAMES, LABEL_SYMBOLS, type Label, type PositionEval } from '../classify/classify.ts';
import { formatScore } from '../engine/uci.ts';
import { sanLine } from '../game/replay.ts';
import { summarise, type GradedMove } from '../review/review.ts';
import type { Notice, View } from './session.ts';

const NOTICES: Record<Notice, string> = {
  'in-progress': 'Game in progress. PonPon reviews it as soon as it ends.',
  'elsewhere-game': 'Another chess.com tab has a game in progress that may be yours. PonPon stays off until it ends.',
  'elsewhere-unread': "PonPon can't read one of your chess.com game tabs, so it can't tell whether a game is in progress there. Reload or close it.",
  unknown: 'PonPon stays off on this page. Open a finished game, the analysis board or a bot game.',
  unsupported: "PonPon doesn't work on this page (variants, puzzles and lessons).",
  'no-reader': "PonPon can't read this tab yet. Reload the page.",
  unreadable: "PonPon can't read this game. Paste the PGN.",
  'other-site': 'Open a game on chess.com, or paste a PGN.',
};


export interface Actions {
  paste(text: string): string | null;
  closePaste(): void;
  review(): void;
  /** SYNC-2: show this move (0-based) on chess.com's board. */
  select(move: number): void;
}

export function mount(actions: Actions): (view: View) => void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $('status');
  const notice = $('notice');
  const held = $('held');
  const pasted = $('pasted');
  const summary = $('summary');
  const moves = $('moves');
  const detail = $('detail');
  const paste = $<HTMLDetailsElement>('paste');
  const pgn = $<HTMLTextAreaElement>('pgn');
  const pasteError = $('paste-error');

  let last: View | null = null;
  let game = '';
  let selected: number | null = null;
  let boardPly: number | null = null;

  const render = (view: View) => {
    last = view;
    const key = JSON.stringify(view.target?.game ?? null);
    if (key !== game) {
      game = key;
      selected = null;
    }
    // SYNC-1: the selected move follows chess.com's board, so the card and the arrows describe the same move.
    if (view.ply !== boardPly) {
      boardPly = view.ply;
      if (view.ply !== null) selected = view.ply > 0 ? view.ply - 1 : null;
    }
    const sans = view.target?.game.sans ?? [];
    const graded = view.moves.filter(Boolean).length;
    status.textContent =
      view.status === 'reviewing' ? `Reviewing ${graded}/${sans.length}`
      : view.status === 'paused' ? 'Paused'
      : view.status === 'failed' ? 'Review failed'
      : '';
    show(notice, view.notice && NOTICES[view.notice]);
    held.hidden = !view.held;
    pasted.hidden = !view.target?.pasted;

    summary.replaceChildren();
    summary.hidden = view.status !== 'done' || !sans.length;
    if (!summary.hidden) summary.append(...summaryCard(view));

    moves.replaceChildren();
    sans.forEach((san, ply) => {
      if (ply % 2 === 0) moves.append(el('span', 'num', `${ply / 2 + 1}.`));
      moves.append(moveButton(san, ply, view.moves[ply], ply === selected));
    });

    detail.replaceChildren();
    const m = selected === null ? undefined : view.moves[selected];
    // A pasted FEN has no moves to grade: show the position itself.
    const start = view.target && !sans.length ? view.positions[0] : undefined;
    detail.hidden = !m && !start;
    if (m) detail.append(...moveCard(m, view.positions[m.ply], view.positions[m.ply + 1]));
    else if (start) detail.append(...positionCard(start));

    paste.hidden = !view.canPaste;
    if (view.notice === 'other-site' || view.notice === 'unreadable') paste.open = true;
  };

  moves.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('[data-ply]');
    if (!button || !last) return;
    selected = Number(button.dataset.ply);
    if (last.target && !last.target.pasted) actions.select(selected);
    render(last);
  });
  $('review-pgn').addEventListener('click', () => {
    const error = actions.paste(pgn.value);
    pasteError.textContent = error ?? '';
    if (!error) {
      pgn.value = '';
      paste.open = false;
    }
  });
  $('close-paste').addEventListener('click', () => actions.closePaste());
  $('review-now').addEventListener('click', () => actions.review());
  return render;
}

function summaryCard(view: View): HTMLElement[] {
  const t = view.target!;
  const s = summarise({ moves: view.moves, positions: view.positions });
  const pct = (x: number | null) => (x === null ? '—' : x.toFixed(1));
  const rows = [row('Accuracy', pct(s.accuracy.w), pct(s.accuracy.b))];
  for (const label of Object.keys(LABEL_NAMES) as Label[]) {
    const [w, b] = [s.counts.w[label] ?? 0, s.counts.b[label] ?? 0];
    if (w || b) rows.push(row(LABEL_NAMES[label], String(w), String(b), label));
  }
  const table = el('table');
  table.append(row('', t.white ?? 'White', t.black ?? 'Black'), ...rows);
  return [
    el('p', 'players', `${t.white ?? 'White'} – ${t.black ?? 'Black'}${t.result ? ` · ${t.result}` : ''}`),
    el('p', 'opening', s.opening ?? 'Opening not in the book'),
    table,
  ];
}

function row(name: string, w: string, b: string, label?: Label): HTMLElement {
  const tr = el('tr', label && `l-${label}`);
  const head = el('td');
  if (label) head.append(el('span', 'dot'));
  head.append(name);
  tr.append(head, el('td', 'n', w), el('td', 'n', b));
  return tr;
}

function moveButton(san: string, ply: number, m: GradedMove | undefined, selected: boolean): HTMLElement {
  const button = el('button', `move${m ? ` l-${m.label}` : ' pending'}${selected ? ' selected' : ''}`);
  button.dataset.ply = String(ply);
  if (m) button.title = LABEL_NAMES[m.label];
  button.append(el('span', 'dot'), san);
  const symbol = m && LABEL_SYMBOLS[m.label];
  if (symbol) button.append(el('span', 'sym', symbol));
  return button;
}

function moveCard(m: GradedMove, before: PositionEval, after: PositionEval): HTMLElement[] {
  const best = before.lines[0];
  const bestSan = sanLine(before.fen, best.pv.slice(0, 1))[0];
  const num = `${Math.floor(m.ply / 2) + 1}${m.side === 'w' ? '.' : '…'}`;
  const drop = m.drop >= 0.05 ? ` (−${m.drop.toFixed(1)}%)` : '';
  const head = el('p', `head l-${m.label}`);
  head.append(el('span', 'dot'), `${num} ${m.san} · ${LABEL_NAMES[m.label]}${drop}`);
  const evalAfter = after.end === 'checkmate' ? 'mate' : after.end === 'draw' ? 'draw' : formatScore(after.lines[0].score);
  return [
    head,
    ...(bestSan === m.san ? [] : [el('p', '', `Best was ${bestSan} (${formatScore(best.score)})`)]),
    el('p', 'line', `Best line: ${sanLine(before.fen, best.pv.slice(0, 6)).join(' ')}`),
    el('p', 'evals', `Eval ${formatScore(best.score)} → ${evalAfter}`),
  ];
}

function positionCard(p: PositionEval): HTMLElement[] {
  if (p.end) return [el('p', 'head', p.end === 'checkmate' ? 'Checkmate' : 'Draw')];
  const [best, second] = p.lines;
  return [
    el('p', 'evals', `Eval ${formatScore(best.score)}`),
    el('p', 'line', `Best line: ${sanLine(p.fen, best.pv.slice(0, 6)).join(' ')}`),
    ...(second ? [el('p', 'line', `Second: ${sanLine(p.fen, second.pv.slice(0, 6)).join(' ')} (${formatScore(second.score)})`)] : []),
  ];
}

function show(e: HTMLElement, text: string | null): void {
  e.hidden = !text;
  e.textContent = text ?? '';
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
