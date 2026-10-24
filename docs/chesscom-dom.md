# chess.com DOM notes (M0 spike, 2026-10-24)

What the adapter relies on, as observed on 2026-10-24. Selectors live in `src/adapter/selectors.ts`. The fixtures that prove each point are in `test/fixtures/chesscom/`.

## URL patterns

| Page | URL | Confirmed by |
|---|---|---|
| Finished Live game | `/game/live/<id>` | `live-finished-*` |
| Live game in progress (spectating) | `/game/<id>` (no `/live/`). **The URL does not change when the game ends** | `live-inprogress-spectator-*`, `live-ended-while-watching-*` |
| Daily game, finished or in progress | `/game/daily/<id>` | `daily-*` |
| Analysis board | `/analysis` | `analysis-*` |
| Bot game, in progress or finished | `/play/computer` | `bot-*` |
| Selected ply on game pages | `?move=N` is appended (N = plies from the start) | seen live |

- `/analysis/game/live/<id>` **redirects to `/analysis/game/live/<id>/review` and starts chess.com's own Game Review**, which may use the free account's daily review. Don't open these URLs in automation.
- Unverified: the URL while *you* play a Live game (`/play/online` → `/game/<id>`?), `/game/computer/<id>`, Chess960, games from a custom start position, puzzles, lessons.

## Structure

- **No shadow DOM** anywhere on these pages; plain `querySelector` reaches everything.
- **Board:** `wc-chess-board` with id `board-single` (game pages), `board-analysis-board` or `board-play-computer`. Class `flipped` = Black at the bottom.
- **Pieces:** `div.piece` with classes such as `wn` and `square-63` (file 6, rank 3 → f3). The class order varies.
- **Move list:** `wc-simple-move-list` on game and bot pages, `wc-move-list` on the analysis board.
  - Each ply is `div.node[data-node="L-I"]`: L = line (0 = main line), I = 0-based ply index within that line. Main-line nodes also have the class `main-line-ply`.
  - SAN = DOM-order text plus figurines. Piece letters are **not in the text**: they're `span[data-figurine="N"]` before the square. Promotion is plain text (`b8=Q`), castling is `O-O`, check and mate suffixes are in the text.
  - Selected move: `.node-highlight-content.selected` inside the node. **No element is selected at the starting position.**
  - Side lines: nodes like `data-node="1-0"` without `main-line-ply`. The branch point isn't in any attribute; it's only implied by DOM position and the "3…" move number.
- **Result:** `.game-result` in a `.result-row` at the end of the move list: `1-0`, `0-1`, `1/2-1/2` (with trailing whitespace). It is present only once the game is over: confirmed on the spectated game that ended while I watched.
- **Game-over modal:** `.game-over-modal-shell-container`. It reappears when a finished game page is reopened. Its header class said `whiteWon` when Black won a bot game, so **don't read the winner from it**.
- **Clocks:** `.clock-component.clock-white/.clock-black`. `clock-player-turn` **stays on the loser's clock after a game ends**, so it is not an in-progress signal.
- **Players:** `#board-layout-player-top` and `#board-layout-player-bottom`, each containing `.cc-user-username-component`. The same on every page type. `cc-user-username-white` is a text-colour class, not the side; map top/bottom to colours through the board orientation. On the analysis board the names are the placeholders "White" and "Black".

## Hazard: never clone chess.com's elements

`document.documentElement.cloneNode(true)` makes the browser construct new `wc-*` custom elements, and their constructors hook into the live app. On the next board update the move list empties or jumps to move 0. This happened on a game page, the analysis board and a bot game, and stopped once capture used `outerHTML` + `DOMParser` (a parsed document has no custom-element registry). **PonPon's content script must only read the live DOM**, never clone or construct `wc-*` elements.

## Capturing a fixture

Chrome blocks automatic downloads from chess.com after the first one, even after a trusted click. What works:

1. Sanitize in the page (no cloning):

   ```js
   const doc = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html');
   doc.querySelectorAll('script, style, noscript, iframe, link, meta, template, input[type="hidden"]').forEach(e => e.remove());
   for (const e of doc.querySelectorAll('*')) for (const a of [...e.attributes]) {
     if (/^on/i.test(a.name)) e.removeAttribute(a.name);
     else if (/(^|-)(href|src|srcset|action|poster)$/i.test(a.name)) e.setAttribute(a.name, a.value.replace(/\?[^\s,"]*/g, ''));
   }
   const html = '<!doctype html>\n' + `<!-- ponpon-fixture url=${location.origin + location.pathname} captured=${new Date().toISOString()} -->\n` + doc.documentElement.outerHTML;
   ```

   The header comment is required: the tests read the page URL from it.
2. Stash each snapshot in `sessionStorage` (it survives navigation within the tab), then inject a button whose click handler copies everything to the clipboard as JSON. Click it with a *real* click (the Claude in Chrome `computer` tool), since `navigator.clipboard.writeText` needs user activation.
3. `pbpaste`, split the JSON into `test/fixtures/chesscom/<name>.html`, then clear the `sessionStorage` keys and the clipboard.

Fixtures contain chess.com usernames and ratings (yours and your opponents'). Fine for a personal repo; review them before publishing.
