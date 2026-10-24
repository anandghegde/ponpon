import * as S from './selectors.ts';

export type Result = '1-0' | '0-1' | '1/2-1/2';

export interface GameRead {
  /** Main line in SAN. */
  sans: string[];
  /** Plies from the start to the selected position; 0 = starting position, null = a side line is selected. */
  ply: number | null;
  /** Side at the bottom of the board. */
  orientation: 'white' | 'black';
  /** Piece placement shown on the board (FEN field 1). */
  placement: string;
  players: { white: string | null; black: string | null };
  result: Result | null;
}

/** Reads the game from a chess.com page. Throws when the page doesn't look the way PonPon expects. */
export function readGame(doc: Document): GameRead {
  const board = doc.querySelector(S.BOARD);
  if (!board) throw new Error('no board');
  const orientation = board.classList.contains(S.BOARD_FLIPPED_CLASS) ? 'black' : 'white';

  const top = doc.querySelector(`${S.PLAYER_TOP} ${S.PLAYER_USERNAME}`)?.textContent?.trim() || null;
  const bottom = doc.querySelector(`${S.PLAYER_BOTTOM} ${S.PLAYER_USERNAME}`)?.textContent?.trim() || null;
  const players = orientation === 'white' ? { white: bottom, black: top } : { white: top, black: bottom };

  return {
    sans: readMainLine(doc),
    ply: readSelectedPly(doc),
    orientation,
    placement: readPlacement(board),
    players,
    result: readResult(doc),
  };
}

function parseNodeId(el: Element): { line: number; index: number } {
  const m = /^(\d+)-(\d+)$/.exec(el.getAttribute(S.MOVE_NODE_ATTR) ?? '');
  if (!m) throw new Error(`bad move node id: ${el.getAttribute(S.MOVE_NODE_ATTR)}`);
  return { line: Number(m[1]), index: Number(m[2]) };
}

function readMainLine(doc: Document): string[] {
  const sans: string[] = [];
  for (const node of doc.querySelectorAll(S.MOVE_NODE)) {
    const { line, index } = parseNodeId(node);
    if (line !== 0) continue;
    if (index !== sans.length) throw new Error(`main line out of order at ply ${index}`);
    sans.push(nodeSan(node));
  }
  return sans;
}

/** Figurines carry the piece letter in an attribute, so walk the node in DOM order. */
function nodeSan(node: Element): string {
  let san = '';
  const walk = (el: Element) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) san += child.textContent;
      else if (child.nodeType === 1) {
        const fig = (child as Element).getAttribute(S.FIGURINE_ATTR);
        if (fig) san += fig;
        else walk(child as Element);
      }
    }
  };
  walk(node);
  return san.replace(/\s+/g, '');
}

function readSelectedPly(doc: Document): number | null {
  const selected = doc.querySelectorAll(S.SELECTED_MOVE);
  if (selected.length === 0) return 0;
  if (selected.length > 1) throw new Error('more than one selected move');
  const { line, index } = parseNodeId(selected[0].closest(S.MOVE_NODE)!);
  return line === 0 ? index + 1 : null;
}

function readPlacement(board: Element): string {
  const squares: string[][] = Array.from({ length: 8 }, () => Array(8).fill(''));
  for (const piece of board.querySelectorAll(S.BOARD_PIECE)) {
    let kind = '';
    let file = 0;
    let rank = 0;
    for (const c of piece.classList) {
      if (/^[wb][pnbrqk]$/.test(c)) kind = c[0] === 'w' ? c[1].toUpperCase() : c[1];
      const sq = /^square-([1-8])([1-8])$/.exec(c);
      if (sq) [file, rank] = [Number(sq[1]), Number(sq[2])];
    }
    if (!kind || !file) continue;
    if (squares[8 - rank][file - 1]) throw new Error(`two pieces on square ${file}${rank}`);
    squares[8 - rank][file - 1] = kind;
  }
  return squares
    .map(row => row.map(p => p || '1').join('').replace(/1+/g, ones => String(ones.length)))
    .join('/');
}

function readResult(doc: Document): Result | null {
  const text = doc.querySelector(`:is(${S.MOVE_LIST}) ${S.GAME_RESULT}`)?.textContent?.trim();
  if (!text) return null;
  if (text === '1-0' || text === '0-1' || text === '1/2-1/2') return text;
  if (text === '½-½') return '1/2-1/2';
  throw new Error(`unknown result: ${text}`);
}
