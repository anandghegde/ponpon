// Every chess.com selector PonPon depends on (SRC-1). Confirmed against the fixtures in
// test/fixtures/chesscom (captured 2026-10-24); see docs/chesscom-dom.md for the page notes.
//
// Never clone chess.com's elements (cloneNode on <wc-*> runs their constructors and breaks the
// live move list). Read the live DOM only.

/** The board. Its id differs per page: board-single, board-analysis-board, board-play-computer. */
export const BOARD = 'wc-chess-board';
/** Present on the board when Black is at the bottom. */
export const BOARD_FLIPPED_CLASS = 'flipped';
/** Pieces on the board. Classes hold the piece (`wp`, `bk`, …) and square (`square-52` = file 5, rank 2). */
export const BOARD_PIECE = '.piece';

/** Move-list containers: wc-simple-move-list on game and bot pages, wc-move-list on the analysis board. */
export const MOVE_LIST = 'wc-simple-move-list, wc-move-list';
/** One ply. `data-node="L-I"`: line L (0 = main line), index I (0-based ply within that line). */
export const MOVE_NODE = '.node[data-node]';
export const MOVE_NODE_ATTR = 'data-node';
/** Piece figurine inside a move; the letter is in this attribute and missing from the text. */
export const FIGURINE_ATTR = 'data-figurine';
/** The clickable move inside a node; clicking it shows that move on chess.com's board (SYNC-2). */
export const MOVE_TEXT = '.node-highlight-content';
/** The highlighted move inside a node. Absent when the starting position is shown. */
export const SELECTED_MOVE = '.node[data-node] .selected';
/** Result row at the end of the move list: "1-0", "0-1" or "1/2-1/2". Only present once the game is over. */
export const GAME_RESULT = '.game-result';

/** Player boxes above and below the board, each with one username. */
export const PLAYER_TOP = '#board-layout-player-top';
export const PLAYER_BOTTOM = '#board-layout-player-bottom';
export const PLAYER_USERNAME = '.cc-user-username-component';

/** The sidebar's link to my own profile, `https://www.chess.com/member/<me>`. Absent when logged out. */
export const MY_PROFILE_LINK = 'a[data-user-activity-key="profile"][href*="/member/"]';
