# Handoff: PonPon M1 (Review MVP), built and checked live

*2026-10-25. Read `docs/PRD.md` §10 (M1 row), §6.4 and §13 first, then `docs/chesscom-dom.md`.*

## Where M1 stands

Everything in M1's scope is built and checked on real chess.com pages, except the one check that needs chess.com's own labels.

| Part | Status | How it was checked |
|---|---|---|
| Classifier (CLS-1, CLS-2, ENG-3) | **Done** | `test/classify.test.ts`, plus two fixes found on real games: Book stops at a mistake, and a sacrifice is measured against the best alternative too (PRD §13, 2026-10-25) |
| Opening book (CLS-4) | **Done** | 7,982 positions from lichess-org/chess-openings at `a6189a3`; `npm run build:book` regenerates it |
| Golden tests (CLS-5) | **Done, labels to hand-check** | 32 positions in `test/golden-cases.ts`: book, Fool's and Scholar's Mates, mates for and against, stalemate, a lost position, only moves, recaptures, a real sacrifice (a desperado that forces stalemate), fake sacrifices, and every drop band, half of them from the user's games. Engine output recorded once (`npm run record:golden`), so `test/golden.test.ts` runs offline |
| Review pipeline (REV-1, REV-4, REV-5, ENG-2) | **Done** | `test/review.test.ts` with the real engine |
| Content script, messaging, page states (SRC-1–5, FP-1, FP-2) | **Done** | Fixtures, and live: `npm run e2e` |
| Side panel (REV-2–4, SRC-4 PGN and FEN, FP-3, ENG-5) | **Done** | `test/session.test.ts` and `npm run e2e` |
| Settings (ENG-4 preset, FP-3 auto-review; DATA-1, DATA-4) | **Done** | In the panel's Settings; `chrome.storage.local`; `storage` permission |
| IndexedDB cache (DATA-1, DATA-2) | **Done** | `test/store.test.ts` (fake-indexeddb) and live: a reviewed game reopens in about 200 ms |
| Watching a game live (FP-7) and the other-tab lock (FP-5) | **Done** (asked, 2026-10-25) | Adapter tests (I'm a player, logged out, a name unread, `/play/online`), session tests, and `npm run e2e` with a planted profile link |
| Arrows and badges on the board, panel ↔ board sync (BRD-1–3, BRD-4 toggles, SYNC-1, SYNC-2; asked) | **Done** | `test/arrows.test.ts`; `npm run e2e`: arrows over the right squares, ← on chess.com moves the card and arrows, a panel click moves chess.com's board, none on a locked page, cleared by the page itself when it turns into my game |
| FP matrix (FP-6) | **Done** | `test/session.test.ts`, and `npm run e2e`: 38 live checks, all passing on 2026-10-25 |
| 20 of the user's games reviewed | **Done** | `agreement/`: the latest 20 games, PGNs and Normal-depth evaluations |
| Label agreement with chess.com (§11) | **Waiting on chess.com labels** | `npm run agreement` compares as soon as `agreement/<id>.chesscom.txt` files exist (format in `agreement/README.md`). The free account allows one Game Review a day |

`npx vitest run` → 165/165, `npm run typecheck` clean, `npm run build` → `dist/`, `npm run e2e` → 38/38. Branch `m1-review` on origin.

## What the live run covers (`npm run e2e`, about 4 minutes)

A finished game reviewed at Normal (63 moves in 22 s, first label 0.5 s after the review starts) · reopened from the store (~200 ms) · Fast preset, kept across panel reloads · chess.com home locked (`unknown`) · puzzles `unsupported` · another site: PGN paste, FEN paste, bad paste refused · a game that ends while watched: nothing shown and engine idle while in progress, review 120 ms after the result appears · auto-review off: the ended game waits for "Review it", a finished game opened later still reviews · empty analysis board shows the position, moves graded as played · someone else's game graded live while in progress, nothing held when it ends · my own game in progress locked · a game of mine in another window locks the analysis board until it closes · a guest bot game graded live · another tab stops the review and it resumes from the cache · a hidden panel pauses and resumes · no network requests from the panel.

## Next steps

1. **User:** reload the unpacked extension (chrome://extensions → PonPon → reload) and any open chess.com tabs, then use it. Report anything that looks wrong.
2. **User:** check the 32 golden labels (`npx vitest run test/golden.test.ts` lists them by name; each name says why).
3. **User, one a day:** after a Game Review on chess.com, put its labels in `agreement/<id>.chesscom.txt`, then `npm run agreement`. With Claude in Chrome connected, Claude can read them off the review page instead.
4. Then M2: live suggestions (`go infinite`, MultiPV 3, eval bar) with arrows that deepen as the engine searches, and BRD-4's shortcut.

## Decisions made (check with the user if any matter)

Earlier, asked: Great's second guard (Scholar's 4.Qxf7# stays Great); the panel talks to the content script directly; FP-3 needs the panel open.

Made while building, not asked:
1. **Book stops at a mistake** (PRD rule 1): the lichess book names Fool's Mate and other traps, so 2.g4?? was "Book". A book move with Δ ≥ 10 is graded normally and ends the book.
2. **A sacrifice is measured against P and against the best other move** played out as far (PRD rule 2), unless that move gets mated. On the user's 20 games the old rule gave a false Brilliant for a bishop that was lost anyway (17…Kc7); the alternative alone gave four more false ones (captures that grabbed less than a greedy alternative). Now there is one, a real exchange sacrifice.
3. **Great is common, about 2.6 per game**, mostly taking a piece left hanging; that follows the approved rule (only move, second best ≥ 10 worse and < 75). Left as is; Great is outside the §11 check.
4. **Stored reviews keep evaluations, not labels** (PRD DATA-1 updated): labels are graded again on open, so they follow `thresholds.ts`. The key is `[engine build, depth, start FEN, SANs]`. A game that grew replaces its shorter versions (a bot game takes one place, not one per move).
5. **Settings in the panel for now:** Strength (Fast/Normal/Deep) and "Review a game as soon as it ends". Changing the strength reviews the shown game again (or reopens it from the store). SET-2's full screen is M3.
6. **Auto-review off:** a game that ends while watched waits for "Review it". A game counts as watched after 3 s in progress, because a finished game's page draws its moves a moment before its result row (PRD FP-3 updated).
7. **FEN paste** reviews the one position: its eval and two best lines.
8. **`/live/game/<id>`** is a game page (chess.com redirects `/game/<id>` there once a game is over, at least logged out).
9. **The panel connects as soon as the content script says it's ready**, not only on the tab's load event; chess.com pages can take many seconds to finish loading. A port that drops after answering means the page is navigating: the panel waits, locked, without "Reload the page".
10. **Dev dependencies:** `fake-indexeddb` 6.2.5 (store tests), `puppeteer-core` 25.13.0 (e2e). Both pinned to releases at least two weeks old.
11. **Watching a game is reviewed live (FP-7, asked).** `spectating` needs my name (sidebar profile link) and both players' names, none equal; anything unread is `in-progress-vs-human`. `/play/online` is never `spectating`.
12. **FP-5 lives in the panel, not the service worker:** the panel keeps a port to every chess.com tab in every window. It locks on another tab that is `in-progress-vs-human`, a game URL that hasn't answered yet (briefly, while it loads), or a game URL whose content script never answers ("Reload or close it"). Discarded tabs don't count. Incognito tabs are invisible to PonPon unless it's allowed there.
13. **Arrows (asked).** Gold = best move in the position on chess.com's board, faint gold = second best, green = what was better than the move that led there (only after Good or worse). They come from the review (depth 16, MultiPV 2); the review evaluates the board's position and the one before it first, and the panel shows positions as they arrive. The layer is `<ponpon-arrows>` (open shadow root) fixed over the board, re-placed every animation frame while shown. The panel's selected move follows chess.com's board (SYNC-1); clicking a move in the panel clicks chess.com's own move (`.node-highlight-content`) (SYNC-2). A badge (!!, !, ?!, ?, ??, label colour) sits on the top-right corner of the square the shown move went to (BRD-3); none for book/best/excellent/good. Settings has separate "Arrows" and "Badges" switches. Label symbols and colours live in `classify.ts` (`LABEL_SYMBOLS`, `LABEL_COLORS`); the panel's CSS repeats the colours.

## What's in the repo

```
public/manifest.json      MV3: sidePanel, storage; host permission https://www.chess.com/*; content script content.js
vite.config.ts            side panel + background → dist/
vite.content.config.ts    the content script on its own, as one IIFE
scripts/build-book.ts     npm run build:book
scripts/review-node.ts    npm run review:node -- <pgn> [fast|normal|deep]
scripts/record-golden.ts  npm run record:golden: engine output for test/golden-cases.ts
scripts/agreement.ts      npm run agreement [-- latest <n>]: §11 label agreement (agreement/README.md)
scripts/e2e.ts            npm run e2e: the live FP matrix in Chrome for Testing (npm run build first)
scripts/bench-node.ts     M0 engine benchmark under Node
src/adapter/              selectors, readGame, classifyPage + isUnlocked, snapshot()
src/content/content.ts    observes the DOM while a panel is connected; announces itself on load
src/classify/             thresholds.ts (every number), classify.ts, book.ts + book.json
src/review/review.ts      PRESETS, review() (skips the engine when every position is cached), summarise()
src/sidepanel/session.ts  panel state: guard, paste, auto-review hold, one review at a time, pause/resume
src/sidepanel/store.ts    ReviewStore: IndexedDB, 500 games, LRU
src/sidepanel/view.ts     rendering; main.ts wires tabs, ports, settings, the store and the engine worker
agreement/                the user's latest 20 games: PGN + evaluations; chess.com labels go here
test/                     adapter, engine, classify, review, session, store, golden (+ golden-cases.ts)
```

## Gotchas (learned the hard way)

- **Never `cloneNode` chess.com's DOM.** Use `outerHTML` + `DOMParser` (`docs/chesscom-dom.md`).
- **Don't open `/analysis/game/...` URLs.** They start chess.com's Game Review and may use the user's one free review a day.
- **Logged out, chess.com hides games in progress** (`/game/<id>` redirects to `/play/online`), so live spectating needs a login. The e2e simulates a game in progress by hiding a finished game's result row (then putting it back), and plants the sidebar's profile link to say who "I" am.
- **chess.com's board swallows its first click** after the page loads; the e2e spends it on an empty square.
- **Chrome for Testing on macOS needs `--use-mock-keychain`** (puppeteer adds it). Without it Chrome waits on a Keychain prompt and every network request hangs.
- Branded Chrome ignores `--load-extension`; Chrome for Testing (in `~/.cache/puppeteer/chrome`) doesn't. An unpacked extension's id is the SHA-256 of its path, first 32 hex digits mapped to a–p.
- chess.com's board takes click-then-click moves; drags from puppeteer don't land, and a board that is still starting drops clicks.
- Claude in Chrome can't open `chrome://` or `chrome-extension://` pages; `javascript_tool` calls time out at 45 s.
- The stockfish module may answer synchronously under Node: register the waiter before sending (`Uci.request` does).
- Golden positions are evaluated from a cold hash, so a game position's eval can differ by a few tenths from the same position mid-game; pick golden moves away from band edges.

## User context

- chess.com username **bowod28216**: about 800 blitz, 1,250 blitz games. **Free account: one Game Review a day.** PubAPI archives: `api.chess.com/pub/player/bowod28216/games/archives`.
- The user approved downloading sanitized fixtures and playing bot games on their account, and chose to capture in-progress Live games by spectating. Anything else (for example capturing their own live game) needs asking again.
- The user wants work finished and checked before being asked to try it (2026-10-25).
