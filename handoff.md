# Handoff: PonPon M0 spike

*2026-10-24. Read `docs/PRD.md` §10 (M0 row) first, then `docs/chesscom-dom.md`.*

## Where M0 stands

M0 has two halves (PRD §10):

| Part | Status | Verify step | Result |
|---|---|---|---|
| **(a) Adapter**: read moves, ply, orientation and state on 5 page types; save HTML fixtures | **Done** | The SAN list matches the downloaded PGN for 5 of the user's games; page-state classification is right on all 5 page types | ✅ `npx vitest run` → 34/34 pass. SAN matches the PubAPI PGN for 5 of the user's Live games plus 1 public Daily game. Classification is right on all 14 fixtures (analysis, finished Live, finished Daily, bot in progress and finished, Live and Daily in progress) |
| **(b) Engine**: Stockfish 19 lite single in a side-panel worker; measure nodes/s and per-position time at depths 12/16/20 | **Done** | Timings in `docs/perf.md`; ENG-4 depths fixed | ✅ The user ran the benchmark in the side panel (Chrome 155): Chrome is within 4% of Node. ENG-4 is now **Fast 12 / Normal 16 / Deep 18**, about 2 s, 31 s and 52 s for a 40-move game (the user chose 18 over 20, which took 100 s). The PRD's ENG-4 and §9 rows are updated |

`npx vitest run` → 41/41 pass, `npm run typecheck` is clean, and `npm run build` produces `dist/`. The Stockfish worker and its WASM load fine in the extension page.

**M0 is complete.** Next is M1 (PRD §10).

## What's in the repo

```
package.json            chess.js 1.4.0, stockfish 19.0.1; dev: vite 8.3.5, vitest 5.0.5, happy-dom 21.0.4, typescript 7.0.2, @types/chrome, @types/node
tsconfig.json           erasableSyntaxOnly + allowImportingTsExtensions: imports use .ts extensions, no enums or parameter properties (Node 26 runs .ts directly)
vite.config.ts          inputs: src/sidepanel/index.html (TODO) and src/background.ts → dist/
public/manifest.json    MV3, permission sidePanel only, CSP with 'wasm-unsafe-eval'
scripts/copy-engine.ts  prebuild: copies stockfish-19-lite-single.{js,wasm} into public/engine/ (gitignored)
src/background.ts       openPanelOnActionClick
src/adapter/selectors.ts  every chess.com selector (SRC-1)
src/adapter/read.ts       readGame(doc) → { sans, ply, orientation, placement, players, result }; throws if the page looks wrong
src/adapter/page-state.ts classifyPage(url, doc) → PageState (SRC-2)
src/game/replay.ts        replay(sans) → FENs (SRC-3); sansFromPgn(pgn)
src/engine/uci.ts         Uci (transport-agnostic, one request at a time) + parseInfo; scores stay side-to-move (ENG-3 is M1's job)
src/engine/bench.ts       runDepth, runSuggest, runBench → markdown report; shared by Node and the side panel
src/sidepanel/            M0 benchmark page: Run, progress, report in a <pre>, Copy. M1 replaces it with the real panel
scripts/bench-node.ts     npm run bench:node: the same benchmark under Node
test/adapter.test.ts      fixture tests (happy-dom)
test/engine.test.ts       parseInfo, Uci ordering, one depth-8 run on the real engine under Node
docs/perf.md              M0(b) setup, Node baseline, provisional reading; Chrome section and ENG-4 decision pending
test/fixtures/chesscom/   14 sanitized page snapshots (the first line holds the page URL)
test/fixtures/pgn/        PubAPI PGNs for the 5 user games + Daily game 1045360362
docs/chesscom-dom.md      DOM findings, hazards, how to capture fixtures
LICENSE                   GPL-3.0 (copied from the stockfish package)
```

No git repo yet. Suggest `git init` and a first commit, but only once the user asks.

## Decisions made in this session (check with the user if any matter)

1. **Unlocking is stricter than FP-2.** A game against a person counts as `finished-game` only when `.game-result` is in the move list. The game-over modal alone doesn't unlock, because it reappears on old pages and its winner class proved wrong once. In every fixture both signals appear together.
2. **`/play/online` is treated like a game page** (locked unless a result shows). Unverified: nobody has captured the user's own Live game yet.
3. **Every page PonPon doesn't recognise is `unknown` (locked)**, including the home page and profiles. Open UI question for M1: FP-1's "Game in progress" message would then show on pages that have no game, so they probably need their own message ("Open a game or the analysis board"), with no new page state.
4. **`readGame` cross-checks against the board (beyond the PRD).** It returns `placement`, the piece placement read from the board's piece elements, and the tests assert that `replay(sans)[ply]` matches it. M1 should use this as principle 1's guard: it catches custom start positions and Chess960, which the adapter can't detect otherwise.
5. **`ply` is `null` when a side line is selected** on the analysis board. Working out the branch point is M1/M2 work (SUG-1 needs the live analysis position); see `docs/chesscom-dom.md`.
6. **The manifest asks only for `sidePanel` for now.** Add `storage` and the `https://www.chess.com/*` host permission (DATA-4) in M1, when they're used.
7. **Fixtures for in-progress games against people come from spectating** (the user's choice: no risk to their account). Capture the user's own in-progress game in M1 with the content script.

## Notes for M1 from M0(b)

- Unconfirmed: the side panel's Copy button may not work. When the user first said they were done, the clipboard held a URL, not the report; it may have been overwritten after Copy. If M1 adds copy or export, test it.
- Timing in Chrome needs the user: Claude in Chrome can't open `chrome://` or `chrome-extension://` pages. Node is within 4% of Chrome, so use `npm run bench:node` for quick checks.
- `bench.ts`'s `DEPTHS` constant is still 12/16/20 (the M0 measurement set). Depth 18 was measured separately; the presets themselves belong in M1's settings (SET-2).

## Background for M0(b) (kept for reference; this plan is done)

What's already known:
- `node_modules/stockfish/bin/stockfish-19-lite-single.js` is itself the worker script. It finds its `.wasm` next to itself (from the script URL, or `#path` in the hash). In the side panel: `new Worker(chrome.runtime.getURL('engine/stockfish-19-lite-single.js'))`; lines arrive as `onmessage` strings, and commands go in through `postMessage`.
- Node uses the same WASM: `require('stockfish')('lite-single', onLine)` → `.processCommand(cmd)`, `.terminate()`. **`go` returns immediately and `stop` is honoured** (tested: `go infinite` stopped at 2.04 s and had reached depth 24 from 1.e4 e5 2.Nf3 Nc6). So `go infinite` plus a timed `stop` will work for SUG-2.
- In Node the engine may call the listener synchronously, so **register the "wait for line X" handler before sending the command**.

Suggested plan:
1. `src/engine/uci.ts`: a transport-agnostic UCI client (`receive(line)`, `request(cmd, until, onLine)`, `init(options)`), plus `parseInfo(line)` → `{depth, multipv, score {cp}|{mate}, nodes, nps, time, pv}`. Skip `info` lines without a score. ENG-3's normalisation to White's view belongs here or in M1.
2. `src/engine/bench.ts`:
   - `runDepth(uci, fens, depth, multiPv = 2)`: `ucinewgame` once per run, then `position fen` + `go depth D` for each position. Record wall time per position and nodes from the last info line. Report total, mean, p50, p90, max and nodes/s.
   - `runSuggest(uci, fen)` with MultiPV 3: time to the first line, to depth 10, to depth 16 and to depth 22, capped at 15 s.
   - Positions: replay `test/fixtures/pgn/185404401434.pgn` (92 positions). Extrapolate to a 40-move game (81 positions) for the §9 target (≤ 60 s at Normal).
   - Proposed options: `Hash 64` (record it), `Threads 1`.
3. `src/sidepanel/index.html` + `main.ts`: a Run button, progress, the results as a markdown table in a `<pre>`, and a Copy button. No framework.
4. `scripts/bench-node.ts`: the same benchmark under Node for a baseline (read the PGN with `fs`).
5. `npm run build`. The **user** has to load `dist/` unpacked (chrome://extensions → Developer mode → Load unpacked), open the side panel from the toolbar icon on any page, run the benchmark and paste the results back. Claude in Chrome can't open `chrome://` or `chrome-extension://` pages.
6. Write `docs/perf.md` (machine, Chrome version, options, both tables) and set ENG-4's Fast/Normal/Deep depths in the PRD from the numbers (target: Normal review ≤ 60 s, first labels ≤ 5 s).

## Gotchas (learned the hard way)

- **Never `cloneNode` chess.com's DOM.** It breaks the live move list. Use `outerHTML` + `DOMParser` (details in `docs/chesscom-dom.md`). An earlier note in this session that "the bot move list empties when the game ends" was caused by this bug and is **wrong**.
- **Don't open `/analysis/game/...` URLs.** They start chess.com's Game Review. This happened once this session, and may have used the user's free daily review.
- Chrome blocks automatic downloads from chess.com. Use the clipboard method in `docs/chesscom-dom.md`.
- Claude in Chrome: `javascript_tool` calls time out at 45 s, so poll in chunks of 25 s or less. Its output filter blocks text that looks like query strings, base64 or JWTs, so return summaries, not raw HTML. Screenshot coordinates aren't CSS pixels: the viewport here was 2048 CSS px wide against a 1568 px screenshot frame.
- Bot games: Martinfoot is preselected at `/play/computer`. Resigning is the flag button followed by an in-page confirm, not a browser dialog.

## User context

- chess.com username **bowod28216**: about 800 blitz, 1,250 blitz games on the PubAPI, no Daily games. The PubAPI archive list is at `api.chess.com/pub/player/bowod28216/games/archives`.
- The user approved downloading sanitized fixtures and playing bot games on their account, and chose to capture in-progress Live games by spectating. Approval for anything else (for example capturing their own live game) has to be asked again.
