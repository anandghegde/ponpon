// Arrows on chess.com's board (BRD-1, BRD-2): an SVG in a shadow root on a fixed, click-through layer that tracks the
// board's box every frame while arrows are shown, so it follows resizes, scrolling, layout changes and flips.
// Nothing is added inside chess.com's own elements.
import * as S from '../adapter/selectors.ts';

/** `best`: the best move in the position on the board; `second`: the next best; `better`: what should have been played instead of the move that led here. */
export interface Arrow {
  from: string;
  to: string;
  kind: 'best' | 'second' | 'better';
}

const LOOK: Record<Arrow['kind'], { color: string; width: number; opacity: number }> = {
  best: { color: '#d4a017', width: 0.2, opacity: 0.9 },
  second: { color: '#d4a017', width: 0.11, opacity: 0.5 },
  better: { color: '#3f9b3f', width: 0.2, opacity: 0.85 },
};
const SVG = 'http://www.w3.org/2000/svg';

let host: HTMLElement | null = null;
let svg: SVGSVGElement | null = null;
let shown: Arrow[] = [];
let box = '';
let frame = 0;

export function draw(arrows: Arrow[]): void {
  shown = arrows;
  if (!arrows.length) {
    cancelAnimationFrame(frame);
    host?.remove();
    host = svg = null;
    box = '';
    return;
  }
  if (!host) {
    host = document.createElement('ponpon-arrows');
    host.style.cssText = 'position: fixed; pointer-events: none; z-index: 2147483647; left: 0; top: 0';
    svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.style.cssText = 'display: block; width: 100%; height: 100%; overflow: visible';
    host.attachShadow({ mode: 'open' }).append(svg);
    document.documentElement.append(host);
  }
  box = '';
  cancelAnimationFrame(frame);
  follow();
}

/** Keeps the layer on the board, and redraws when the board flips. */
function follow(): void {
  const board = document.querySelector(S.BOARD);
  if (host && svg && board) {
    const r = board.getBoundingClientRect();
    const flipped = board.classList.contains(S.BOARD_FLIPPED_CLASS);
    const now = `${r.left} ${r.top} ${r.width} ${r.height} ${flipped}`;
    if (now !== box) {
      box = now;
      Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      svg.replaceChildren(...shown.map((a) => arrow(a, flipped)));
    }
  }
  frame = requestAnimationFrame(follow);
}

function arrow(a: Arrow, flipped: boolean): SVGElement {
  const { color, width, opacity } = LOOK[a.kind];
  const p = document.createElementNS(SVG, 'polygon');
  p.setAttribute('points', arrowPoints(a.from, a.to, flipped, width).map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' '));
  p.setAttribute('fill', color);
  p.setAttribute('opacity', String(opacity));
  p.dataset.kind = a.kind;
  return p;
}

/** A square's centre in board units (0–8, top left is 0,0) as the board shows it. */
export function squareCentre(square: string, flipped: boolean): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return flipped ? [7.5 - file, rank + 0.5] : [file + 0.5, 7.5 - rank];
}

/** The outline of an arrow from one square's centre to another's, `width` squares wide, head included. */
export function arrowPoints(from: string, to: string, flipped: boolean, width: number): [number, number][] {
  const [x1, y1] = squareCentre(from, flipped);
  const [x2, y2] = squareCentre(to, flipped);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const [nx, ny] = [-uy, ux];
  const head = Math.min(0.5, len / 2);
  const [hx, hy] = [x2 - ux * head, y2 - uy * head];
  const [w, hw] = [width / 2, width * 1.6];
  return [
    [x1 + nx * w, y1 + ny * w],
    [hx + nx * w, hy + ny * w],
    [hx + nx * hw, hy + ny * hw],
    [x2, y2],
    [hx - nx * hw, hy - ny * hw],
    [hx - nx * w, hy - ny * w],
    [x1 - nx * w, y1 - ny * w],
  ];
}
