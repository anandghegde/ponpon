# Handoff: PonPon M3 (v1.0) and M4 (v1.1), built

*2026-10-25. Read `docs/PRD.md` §6.4, §6.5, §6.9, §10 and §13 (the newest "to confirm" block), then `docs/chesscom-dom.md`.*

## 2026-10-25 (later): live suggestions in your own games

The user asked for live suggestions in their own in-progress games too (until then only finished games, bot games and watched games got them), knowing chess.com's Fair Play Policy bans engine help during play. Typecheck and build pass; this change isn't committed.

- `page-state.ts`: `spectating` and `in-progress-vs-human` collapsed into `live-game`, which is unlocked — a game against a person in progress, mine or anyone's. The neither-player-is-me check (`watching()`), `MY_PROFILE_LINK` and `isHumanGameUrl` are gone (`test/adapter.test.ts` still refers to the selector; tests aren't maintained and sit outside tsconfig).
- `session.ts` / `main.ts`: FP-5's every-tab lock (`Elsewhere`, `elsewhere()`, `setElsewhere`) and the "Game in progress" notice are removed; FP-3's end-of-game hold now keys on `live-game` → finished. Own games behave exactly like spectated ones: reviewed live, suggestions and arrows on the position the board shows.
- The first-run intro and the README state the fair-play risk instead of describing the old lock; PRD §6.2 is now "Page lock" (FP-5 marked removed) and §13 records the decision.

## Where things stand (M3/M4, earlier on 2026-10-25)

## Where things stand

Nothing since M1 is committed (branch `m1-review`; the user chose not to commit yet). Everything below builds (`npm run build` → `dist/`) and `npm run typecheck` is clean. Per the user, there are no tests any more; the checks were the build, the typecheck, a render of the real `view.ts` in headless Chrome from a real review, and `npm run review:node`.

| Part | Status | Checked |
|---|---|---|
| M2 (suggestions, live arrows, shortcut) | Built | e2e 47/48 before the "no tests" decision; the fix for the one failure (engine card moved below the move list) never got an e2e run |
| Removed: label agreement with chess.com's Game Review | Done | `scripts/agreement.ts`, `agreement/` and `npm run agreement` deleted; PRD G4, §10 (M1), §11 and §13 updated |
| SET-1 labels in English, Kanglish or ಕನ್ನಡ, hover shows the other two and the Kanglish meaning | Done | Rendered: summary, move card |
| SET-2 settings | Done | Labels, strength, suggestion lines, auto-review, arrows, badges, stored reviews |
| SET-3 stored reviews: count, size, Clear | Done | Typecheck only (needs IndexedDB in the extension) |
| SET-4 first-run screen | Done | Rendered at 360 px |
| SET-5 Noto Sans Kannada subset (42 kB, `public/fonts/`, OFL beside it) | Done | Rendered side by side with the full font: identical shapes |
| Gold-pawn logo and icons (16/32/48/128), About with GPL and source links, README with unpacked install | Done | Icons viewed at 16 and 128 px on light and dark |
| Version 1.0.0 | Done | manifest and package.json |
| CLS-3 Kai Jaaritu (Miss), badge ×, pink | Done | `review:node`: unpunished blunders become misses |
| REV-6 Lichess's game accuracy | Done | Ported from lila's `AccuracyPercent.gameAccuracy` and scalalib's `Maths`. M4's own check (±3 of Lichess on 10 games exported there) wasn't run |
| REV-7 eval graph, REV-8 key moments | Done | Rendered from a real review; clicking selects moves (wired like the move list, not clicked in the render) |

## What you'll see (new)

- **First open:** a one-screen intro (what PonPon does, the lock, the labels). "Got it" hides it; Settings → About → "Show the intro again".
- **Settings:** Labels (English / Kanglish / ಕನ್ನಡ) at the top; "Stored reviews: N games, X MB · Clear" at the bottom.
- **About:** version, Win% model, GPL-3.0 and source links, credits.
- **Summary card:** an eval graph under the opening (click to jump), and "Key moments" under the table.
- **Labels:** Miss (*Kai Jaaritu*, pink ×) after an unpunished mistake. Accuracy is now Lichess's, book moves included.
- The gold pawn in the toolbar, on `chrome://extensions` and in the panel's header.

## Next steps

1. **User:** `npm run build`, reload PonPon at `chrome://extensions` and any chess.com tabs. Look over the intro, Settings (label sets, Clear), the summary's graph and key moments, and a game with a Miss.
2. **Waiting on the user:** the two known gaps below. Both need a look at chess.com's analysis board in the user's Chrome first (not asked yet).
3. Confirm the decisions in PRD §13's newest block and the M2 one before it.

## Known gaps

- **Side lines on the analysis board:** no lines or arrows there (M2 decision 8). `test/fixtures/chesscom/analysis-variation-selected.html` has one side line of one move: a `.variation-row` after the main-line row, nodes `data-node="1-0"`, the branch only in the move number (`3...`). Nested lines aren't captured. A plan that fails safe: build the side line's moves from the move numbers, then accept them only if the result matches the board's placement (`readPlacement`); the session then needs a live search for a position that isn't on the main line.
- **`/analysis?fen=…`** reads as "can't read this game": the adapter assumes the standard start. Unknown: whether `fen` stays in the URL after moves, and where a board set up by hand keeps its start position.

## Decisions

M3 and M4's are in PRD §13 ("while building M3 and M4; to confirm"). M2's are in the block before it, with the reasons in this file's history (`git log -p handoff.md` once committed).

## Decisions from M1 (asked or confirmed earlier)

Earlier, asked: Great's second guard (Scholar's 4.Qxf7# stays Great); the panel talks to the content script directly; FP-3 needs the panel open; arrows and badges on the board in M1; watching a game is reviewed live (FP-7).

Made while building M1, not asked: book stops at a mistake; a sacrifice is measured against the best alternative too; Great is common (about 2.6 a game); stored reviews keep evaluations, not labels; settings live in the panel for now; with auto-review off a game counts as watched after 3 s; FEN paste reviews the one position; `/live/game/<id>` is a game page; the panel connects as soon as the content script says it's ready; FP-5 lives in the panel (a port per chess.com tab); arrows: gold best, faint gold second, green "better" after Good or worse; badges on the target square's top-right corner. Details are in `docs/PRD.md` §13 and in this file's history (`git log -p handoff.md`).

## What's in the repo

```
public/manifest.json      MV3: sidePanel, storage; host https://www.chess.com/*; content script; commands; icons; 1.0.0
public/icons/             logo.svg (the gold pawn) and icon-16/32/48/128.png, drawn with rsvg-convert
public/fonts/             noto-sans-kannada-labels.woff2 (SET-5) and OFL.txt
README.md                 install (unpacked), features, the lock, development, the font's subset command
vite.config.ts            side panel + background → dist/
vite.content.config.ts    the content script on its own, as one IIFE
scripts/build-book.ts     npm run build:book
scripts/review-node.ts    npm run review:node -- <pgn> [fast|normal|deep]
scripts/record-golden.ts  (tests: not used any more)
scripts/e2e.ts            (tests: not used any more)
scripts/bench-node.ts     M0 engine benchmark under Node
src/adapter/              selectors, readGame, classifyPage + isUnlocked, snapshot()
src/content/              content.ts: observes the DOM while a panel is connected; overlay.ts: arrows and badge layer
src/classify/             thresholds.ts (every number), classify.ts (labels in 3 sets, Miss, capped Win%), book.ts + book.json
src/engine/uci.ts         UCI client, parseInfo, positionCommand (start + moves)
src/review/review.ts      PRESETS, review(), summarise() with Lichess's game accuracy
src/suggest/suggest.ts    suggest(): go infinite, MultiPV, whole iterations, depth 22 or 15 s
src/sidepanel/session.ts  panel state: page lock, paste, auto-review hold, review then live search, 4 updates a second
src/sidepanel/arrows.ts   what the board shows: best moves from the panel's lines, "better", badge
src/sidepanel/store.ts    ReviewStore: IndexedDB, 500 games, LRU, size(), clear()
src/sidepanel/view.ts     rendering: label sets, intro legend, summary with graph and key moments, moves, engine card
src/sidepanel/main.ts     wires tabs, ports, settings, intro, cache, the shortcut, the store and the engine worker
test/                     kept but not run or maintained
```

## Gotchas (learned the hard way)

- **Never `cloneNode` chess.com's DOM.** Use `outerHTML` + `DOMParser` (`docs/chesscom-dom.md`).
- **Don't open `/analysis/game/...` URLs.** They start chess.com's Game Review and may use the user's one free review a day.
- **Logged out, chess.com hides games in progress** (`/game/<id>` redirects to `/play/online`), so live spectating needs a login. The e2e simulates a game in progress by hiding a finished game's result row (then putting it back), and plants the sidebar's profile link to say who "I" am.
- **chess.com's board swallows its first click** after the page loads; the e2e spends it on an empty square.
- **Chrome for Testing on macOS needs `--use-mock-keychain`** (puppeteer adds it). Without it Chrome waits on a Keychain prompt and every network request hangs.
- Branded Chrome ignores `--load-extension`; Chrome for Testing (in `~/.cache/puppeteer/chrome`) doesn't. An unpacked extension's id is the SHA-256 of its path, first 32 hex digits mapped to a–p.
- chess.com's board takes click-then-click moves; drags from puppeteer don't land, and a board that is still starting drops clicks.
- **Promotion:** chess.com opens a picker over the target square; the queen is `.promotion-piece.wq` (or `bq`) on that square.
- **Flip:** chess.com's visible button is `button[aria-label="Flip Board"]` (there's a hidden `#board-controls-flip` too).
- **The guest bot** on `/play/computer` is Martinfoot (250); Start, then Play; the guest has White.
- **A key press from CDP never reaches Chrome's extension shortcuts**; check `chrome.commands.getAll()` instead.
- **Anything above the move list that changes height** moves the moves under the pointer; puppeteer's `click(…, { delay })` catches it, `element.click()` doesn't.
- Claude in Chrome can't open `chrome://` or `chrome-extension://` pages; `javascript_tool` calls time out at 45 s.
- The stockfish module may answer synchronously under Node: register the waiter before sending (`Uci.request` does).
- Golden positions are evaluated from a cold hash, so a game position's eval can differ by a few tenths from the same position mid-game; pick golden moves away from band edges.
- Stockfish prints lines it hasn't searched again yet at the previous depth (`depth − 1`) in the same burst; an iteration is complete only when every line has the same depth (`suggest.ts`).
- **Headless Chrome's `--screenshot` hangs on a page that runs a module script** (fine on static HTML). Drive it with puppeteer-core instead (`--allow-file-access-from-files` for a `file://` page).
- **Subsetting the Kannada font:** keep the vowel-sign range (`U+0CBC-0CCD, U+0CD5-0CD6`), or ೊ, ೋ and ೈ break: they're shaped from parts that aren't in the labels (README, Development).

## User context

- chess.com username **bowod28216**: about 800 blitz, 1,250 blitz games. **Free account: one Game Review a day.** PubAPI archives: `api.chess.com/pub/player/bowod28216/games/archives`.
- The user approved downloading sanitized fixtures and playing bot games on their account, and chose to capture in-progress Live games by spectating. Anything else (for example capturing their own live game) needs asking again. The e2e's bot game runs as a logged-out guest, not on the account.
- The user wants work finished and checked before being asked to try it (2026-10-25).
- **No tests** (2026-10-25): don't write, run or fix vitest, `npm run e2e` or the golden tests. The files stay; `test/` is out of `tsconfig.json`, so `npm run typecheck` covers `src` and `scripts` only. Check work with `npm run typecheck` and `npm run build`.
- **The user doesn't care about chess.com's Game Review**: the label-agreement check is gone (`scripts/agreement.ts`, `agreement/`, §11's metric).
- **The user wants live suggestions in their own live games** (2026-10-25): the fair-play guard against own games is gone by their choice, risk (account closure) stated in the intro and README. Spectating fixtures stay the only in-progress captures; capturing their own live game still needs asking.
