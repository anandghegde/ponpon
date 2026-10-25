// Renders a Session view: the notice, the summary card (REV-4, REV-7's eval graph, REV-8's key moments), the move list
// with label badges (REV-2), the eval bar and engine lines (SUG-2, SUG-4), the selected-move card (REV-3) and the paste
// box (SRC-4), with labels in SET-1's set. Plain DOM, rebuilt on every view (the summary and the move list only when
// they change); text only, never HTML, since player names come from the page or a pasted PGN.
import {
  cappedWinPercent,
  KANGLISH_MEANINGS,
  LABEL_KANGLISH,
  LABEL_KANNADA,
  LABEL_NAMES,
  LABEL_SYMBOLS,
  winPercent,
  type Label,
  type PositionEval,
} from '../classify/classify.ts';
import { DROP } from '../classify/thresholds.ts';
import { formatScore } from '../engine/uci.ts';
import { sanLine } from '../game/replay.ts';
import { summarise, type GradedMove } from '../review/review.ts';
import type { Lines, Notice, View } from './session.ts';

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

/** SET-1: English by default. */
export type LabelSet = 'english' | 'kanglish' | 'kannada';
const LABEL_SETS: Record<LabelSet, Record<Label, string>> = {
  english: LABEL_NAMES,
  kanglish: LABEL_KANGLISH,
  kannada: LABEL_KANNADA,
};

/** SET-4: what each label means, on the first-run screen. */
const LABEL_MEANINGS: Record<Label, string> = {
  book: 'opening theory',
  brilliant: 'a sound sacrifice, the best move or close to it',
  great: 'the only move that holds',
  best: "the engine's move, or just as good",
  excellent: `loses under ${DROP.excellent}% of your winning chances`,
  good: `loses ${DROP.excellent}–${DROP.good}%`,
  inaccuracy: `loses ${DROP.good}–${DROP.inaccuracy}%`,
  mistake: `loses ${DROP.inaccuracy}–${DROP.mistake}%`,
  miss: "doesn't punish the opponent's mistake",
  blunder: `loses ${DROP.mistake}% or more`,
};

/** Labels marked on REV-7's eval graph. */
const GRAPH_DOTS: ReadonlySet<Label> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

export interface Actions {
  paste(text: string): string | null;
  closePaste(): void;
  review(): void;
  /** SYNC-2: show this move (0-based) on chess.com's board. */
  select(move: number): void;
  /** A pasted game has no board: the panel picks its position (plies from the start). */
  pick(position: number): void;
}

export function mount(actions: Actions, prefs: { labels: LabelSet }): (view: View) => void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $('status');
  const notice = $('notice');
  const held = $('held');
  const pasted = $('pasted');
  const engine = $('engine');
  const summary = $('summary');
  const moves = $('moves');
  const detail = $('detail');
  const paste = $<HTMLDetailsElement>('paste');
  const pgn = $<HTMLTextAreaElement>('pgn');
  const pasteError = $('paste-error');
  for (const label of Object.keys(LABEL_NAMES) as Label[]) {
    const li = el('li', `l-${label}`);
    li.append(el('span', 'dot'), el('b', '', `${LABEL_NAMES[label]} · ${LABEL_KANGLISH[label]} · ${LABEL_KANNADA[label]}`));
    li.append(`: ${LABEL_MEANINGS[label]}`);
    $('legend').append(li);
  }

  let last: View | null = null;
  let game = '';
  let selected: number | null = null;
  let boardPly: number | null = null;
  let movesShown = '';
  let summaryShown = '';

  const render = (view: View) => {
    last = view;
    const key = JSON.stringify(view.target?.game ?? null);
    if (key !== game) {
      game = key;
      selected = null;
    }
    // SYNC-1: the selected move follows chess.com's board, so the card and the arrows describe the same move.
    if (view.current !== boardPly) {
      boardPly = view.current;
      if (view.current !== null) selected = view.current > 0 ? view.current - 1 : null;
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

    engine.replaceChildren();
    engine.hidden = !view.suggestion;
    if (view.suggestion) engine.append(...engineCard(view.suggestion));
    engine.dataset.current = String(view.current);

    // Its buttons and graph must survive the live lines' re-renders too.
    summary.hidden = view.status !== 'done' || !sans.length;
    const summaryKey = summary.hidden ? '' : JSON.stringify([view.target, view.moves, selected, prefs.labels]);
    if (summaryKey !== summaryShown) {
      summaryShown = summaryKey;
      summary.replaceChildren();
      if (!summary.hidden) summary.append(...summaryCard(view, prefs.labels, selected));
    }

    // Live lines re-render up to 4 times a second; a button replaced between mousedown and mouseup loses its click.
    const movesKey = JSON.stringify([sans, [...view.moves].map((m) => m?.label), selected, prefs.labels]);
    if (movesKey !== movesShown) {
      movesShown = movesKey;
      moves.replaceChildren();
      sans.forEach((san, ply) => {
        if (ply % 2 === 0) moves.append(el('span', 'num', `${ply / 2 + 1}.`));
        moves.append(moveButton(san, ply, view.moves[ply], ply === selected, prefs.labels));
      });
    }

    detail.replaceChildren();
    const m = selected === null ? undefined : view.moves[selected];
    // A pasted FEN has no moves to grade: show the position itself.
    const start = view.target && !sans.length ? view.positions[0] : undefined;
    detail.hidden = !m && !start;
    if (m) detail.append(...moveCard(m, view.positions[m.ply], view.positions[m.ply + 1], prefs.labels));
    else if (start) detail.append(...positionCard(start));

    paste.hidden = !view.canPaste;
    if (view.notice === 'other-site' || view.notice === 'unreadable') paste.open = true;
  };

  const choose = (move: number) => {
    if (!last) return;
    selected = move;
    if (last.target?.pasted) actions.pick(selected + 1);
    else if (last.target) actions.select(selected);
    render(last);
  };
  const chooseButton = (e: Event) => {
    const button = (e.target as Element).closest<HTMLElement>('[data-ply]');
    if (button) choose(Number(button.dataset.ply));
  };
  moves.addEventListener('click', chooseButton);
  summary.addEventListener('click', (e) => {
    const graph = (e.target as Element).closest<SVGSVGElement>('svg.graph');
    if (!graph) return chooseButton(e);
    // REV-7: the move that leads to the position nearest the click.
    const box = graph.getBoundingClientRect();
    const n = Number(graph.dataset.moves);
    choose(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - box.left) / box.width) * n) - 1)));
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

/** SUG-4's eval bar (White's winning chances, from the left) and SUG-2's lines: eval, first 8 plies, depth. */
function engineCard(s: Lines): HTMLElement[] {
  const head = el('p', 'eng-head');
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  bar.append(fill);
  if (s.end) {
    const white = s.end === 'draw' ? 50 : s.fen.split(' ')[1] === 'b' ? 100 : 0;
    fill.style.width = `${white}%`;
    head.append(el('span', 'eval', s.end === 'checkmate' ? 'Checkmate' : 'Draw'));
    return [head, bar];
  }
  const best = s.lines[0];
  fill.style.width = `${winPercent(best.score)}%`;
  head.append(el('span', 'eval', formatScore(best.score)), el('span', 'depth', `depth ${s.depth}${s.searching ? '…' : ''}`));
  const lines = s.lines.map((l) => {
    const p = el('p', 'eng-line');
    p.dataset.uci = l.pv[0];
    p.append(el('span', 'score', formatScore(l.score)), sanLine(s.fen, l.pv.slice(0, 8)).join(' '));
    return p;
  });
  return [head, bar, ...lines];
}

function summaryCard(view: View, set: LabelSet, selected: number | null): Element[] {
  const t = view.target!;
  const s = summarise({ moves: view.moves, positions: view.positions });
  const pct = (x: number | null) => (x === null ? '—' : x.toFixed(1));
  const rows = [row('Accuracy', pct(s.accuracy.w), pct(s.accuracy.b))];
  for (const label of Object.keys(LABEL_NAMES) as Label[]) {
    const [w, b] = [s.counts.w[label] ?? 0, s.counts.b[label] ?? 0];
    if (w || b) rows.push(row(labelName(label, set), String(w), String(b), label));
  }
  const table = el('table');
  table.append(row('', t.white ?? 'White', t.black ?? 'Black'), ...rows);
  return [
    el('p', 'players', `${t.white ?? 'White'} – ${t.black ?? 'Black'}${t.result ? ` · ${t.result}` : ''}`),
    el('p', 'opening', s.opening ?? 'Opening not in the book'),
    evalGraph(view, selected),
    table,
    ...keyMoments(view, set),
  ];
}

const GRAPH = { width: 300, height: 60 };

/** REV-7: White's Win% across the game (White's share filling from the bottom, as on the eval bar), with label dots. */
function evalGraph(view: View, selected: number | null): SVGSVGElement {
  const { width, height } = GRAPH;
  const n = view.positions.length - 1;
  const x = (i: number) => (i * width) / n;
  const y = (i: number) => height - (cappedWinPercent(view.positions[i]) * height) / 100;
  const points = view.positions.map((_, i) => `${x(i).toFixed(1)},${y(i).toFixed(1)}`).join(' L');
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'graph' }) as SVGSVGElement;
  svg.dataset.moves = String(n);
  svg.append(
    svgEl('rect', { width, height, class: 'g-black' }),
    svgEl('path', { d: `M0,${height} L${points} L${width},${height} Z`, class: 'g-white' }),
    svgEl('line', { x1: 0, x2: width, y1: height / 2, y2: height / 2, class: 'g-mid' }),
  );
  if (selected !== null) {
    svg.append(svgEl('line', { x1: x(selected + 1), x2: x(selected + 1), y1: 0, y2: height, class: 'g-selected' }));
  }
  for (const m of view.moves) {
    if (m && GRAPH_DOTS.has(m.label)) svg.append(svgEl('circle', { cx: x(m.ply + 1), cy: y(m.ply + 1), r: 3, class: `l-${m.label}` }));
  }
  return svg;
}

/** REV-8: each side's 3 biggest drops, Inaccuracy or worse, biggest first. */
function keyMoments(view: View, set: LabelSet): HTMLElement[] {
  const t = view.target!;
  const sides = (['w', 'b'] as const).flatMap((side) => {
    const worst = view.moves
      .filter((m) => m.side === side && m.drop >= DROP.good)
      .sort((a, b) => b.drop - a.drop)
      .slice(0, 3);
    if (!worst.length) return [];
    const p = el('p', 'moments');
    p.append(el('span', 'line', `${(side === 'w' ? t.white : t.black) ?? (side === 'w' ? 'White' : 'Black')}:`));
    for (const m of worst) {
      const button = el('button', `move l-${m.label}`);
      button.dataset.ply = String(m.ply);
      button.title = `${LABEL_SETS[set][m.label]} · ${otherNames(m.label, set)}`;
      button.append(el('span', 'dot'), `${moveNumber(m)} ${m.san} −${m.drop.toFixed(0)}%`);
      p.append(button);
    }
    return [p];
  });
  return sides.length ? [el('p', 'head', 'Key moments'), ...sides] : [];
}

function row(name: string | Node, w: string, b: string, label?: Label): HTMLElement {
  const tr = el('tr', label && `l-${label}`);
  const head = el('td');
  if (label) head.append(el('span', 'dot'));
  head.append(name);
  tr.append(head, el('td', 'n', w), el('td', 'n', b));
  return tr;
}

/** SET-1: a label in the chosen set; hovering shows the other two names and what the Kanglish word means. */
function labelName(label: Label, set: LabelSet): HTMLElement {
  const span = el('span', '', LABEL_SETS[set][label]);
  span.title = otherNames(label, set);
  return span;
}

function otherNames(label: Label, set: LabelSet): string {
  const names = (Object.keys(LABEL_SETS) as LabelSet[])
    .filter((s) => s !== set)
    .map((s) => (s === 'kanglish' ? `${LABEL_KANGLISH[label]} ${KANGLISH_MEANINGS[label]}` : LABEL_SETS[s][label]));
  if (set === 'kanglish') names.push(KANGLISH_MEANINGS[label]);
  return names.join(' · ');
}

function moveButton(san: string, ply: number, m: GradedMove | undefined, selected: boolean, set: LabelSet): HTMLElement {
  const button = el('button', `move${m ? ` l-${m.label}` : ' pending'}${selected ? ' selected' : ''}`);
  button.dataset.ply = String(ply);
  if (m) button.title = `${LABEL_SETS[set][m.label]} · ${otherNames(m.label, set)}`;
  button.append(el('span', 'dot'), san);
  const symbol = m && LABEL_SYMBOLS[m.label];
  if (symbol) button.append(el('span', 'sym', symbol));
  return button;
}

function moveCard(m: GradedMove, before: PositionEval, after: PositionEval, set: LabelSet): HTMLElement[] {
  const best = before.lines[0];
  const bestSan = sanLine(before.fen, best.pv.slice(0, 1))[0];
  const num = moveNumber(m);
  const drop = m.drop >= 0.05 ? ` (−${m.drop.toFixed(1)}%)` : '';
  const head = el('p', `head l-${m.label}`);
  head.append(el('span', 'dot'), `${num} ${m.san} · `, labelName(m.label, set), drop);
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

function moveNumber(m: GradedMove): string {
  return `${Math.floor(m.ply / 2) + 1}${m.side === 'w' ? '.' : '…'}`;
}

function show(e: HTMLElement, text: string | null): void {
  e.hidden = !text;
  e.textContent = text ?? '';
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) e.setAttribute(name, String(value));
  return e;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
