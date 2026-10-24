# PonPon — Product Requirements Document

| | |
|---|---|
| Status | Draft v0.2. Decisions from 2026-10-24 applied (§13) |
| Date | 2026-10-24 |
| Author | Anand Hegde |
| Product | **PonPon – Chess Move Coach**, a Chrome extension (Manifest V3) for chess.com |
| Tagline | *Turn every pawn into gold.* |
| Name | ಪೊನ್ (*pon*) is Hale Gannada for gold (modern ಹೊನ್ನು) and sounds like "pawn". A pawn that reaches the last rank promotes: pawn → pon. The doubling follows Kannada words like ಥಳಥಳ (glittering) |

---

## 1. Summary

PonPon sits in Chrome's side panel next to chess.com and does two things:

1. **Grades every move** of a game, mine and my opponent's: how much it changed the winning chances, what the best move was, and a label (Brilliant, Blunder and so on in English by default, or the Kanglish set: *Pon!*, *Ayyo*).
2. **Suggests the next move** for the position on the board: the engine's top lines with evaluations in the side panel, and the same lines drawn live as arrows on the chess.com board.

It runs Stockfish locally in the browser (WebAssembly). There's no server, no account and no limit. Chess.com gives free accounts one full Game Review a day; PonPon reviews every game, and starts on its own the moment a game ends.

PonPon is for analysis. It shows engine output on finished games, the analysis board, bot games and pasted PGNs. While a game against a person is in progress it shows nothing, and it reviews that game as soon as the result appears (§6.2).

## 2. Goals and non-goals

### Goals
- G1. Within about 60 seconds of a game ending, show which moves cost me and what I should have played, without leaving chess.com or clicking anything.
- G2. Unlimited free reviews, all computed locally.
- G3. Next-move suggestions that show up in under 1 second and keep improving while I look.
- G4. Labels that are fun and still accurate: within one category of chess.com's Game Review on most moves (§11).
- G5. My chess.com account is never at risk from using PonPon.

### Non-goals (v1)
- Engine output during in-progress games against people (Live or Daily).
- Sites other than chess.com. Lichess already has free analysis.
- Firefox, Safari or mobile.
- A cloud engine, accounts, or sync across devices.
- Plain-language explanations ("why was this a mistake?") from an LLM. See §6.11.
- Chess960 and other variants. PonPon shows "variant not supported".
- Publishing to the Chrome Web Store. v1 is loaded unpacked for my own use.

## 3. Users and jobs to be done

| User | Job |
|---|---|
| Me: a club player who plays rapid and blitz on chess.com | "When a game ends, I want to see where it turned and what I missed, while I still remember what I was thinking." |
| Me, studying | "When I'm exploring a position on the analysis board, I want the engine's top moves on the board without opening another tool." |
| Me, against bots | "When I practise against a bot, I want live hints and live grades so I learn as I play." |
| Kannada-speaking chess players (if it's published later) | Same jobs, with labels that make them smile. |

## 4. Competitive position

| Product | What it does | Gap PonPon fills |
|---|---|---|
| chess.com Game Review | Move labels, accuracy, coach. Free accounts get one review a day | Unlimited, automatic, no paywall |
| chess.com analysis board | Free engine lines | No per-move grades for a whole game |
| Lichess analysis | Free; marks inaccuracies, mistakes and blunders | Requires exporting the game; no brilliant/great labels; not on chess.com |
| wintrcat "Game Review" (chess.wintrcat.uk) and similar free web apps | Paste a PGN and get chess.com-style labels | Have to leave the page and paste; nothing is drawn on the chess.com board |

What sets PonPon apart: it works in the page, it's automatic, it's local, and it has a voice of its own (the labels).

## 5. Product principles

1. **Never guess.** If PonPon can't read the page, it says so and offers PGN paste. It never shows analysis of the wrong position.
2. **Unknown means locked.** If PonPon can't tell whether a game against a person is over, it treats the game as in progress.
3. **Local and private.** The only network requests go to chess.com, which the user is already on. No analytics.
4. **Fast first, then deep.** Show a quick answer right away and refine it, rather than wait for a perfect one.
5. **Stay out of chess.com's way.** Overlays never block clicks. PonPon never changes chess.com's DOM beyond its own overlay container.

## 6. Functional requirements

Priority: **P0** = v1.0, **P1** = v1.1, **P2** = later.

### 6.1 Reading the game (SRC)

| ID | Requirement | Pri |
|---|---|---|
| SRC-1 | A content script on `https://www.chess.com/*` reads the move list (SAN), the starting position, the selected ply, the board orientation, the players and the result from the DOM. Every selector lives in one file (`src/adapter/selectors.ts`), found during the M0 spike. | P0 |
| SRC-2 | Classify each page as one of: `analysis`, `finished-game`, `bot-game`, `in-progress-vs-human`, `unsupported` (variants, puzzles, lessons), `unknown`. Uses URL patterns plus DOM signals (a visible result, the game-over panel, running clocks). The URL patterns are confirmed in M0. | P0 |
| SRC-3 | Rebuild every position with `chess.js` from the SAN list. If any move fails to parse, stop and show "PonPon can't read this game. Paste the PGN" (principle 1). | P0 |
| SRC-4 | **Paste PGN or FEN** in the side panel. This works on any page and keeps PonPon useful if chess.com changes its DOM. | P0 |
| SRC-5 | Watch the move list with a `MutationObserver` and push changes to the side panel within 200 ms (new moves on the analysis board, a bot game, or the result appearing). | P0 |
| SRC-6 | Fallback for finished games: fetch the PGN from the chess.com PubAPI (`api.chess.com/pub/player/{user}/games/{YYYY}/{MM}`) and match it by game id. Its endpoints refresh at most every 12 hours, so this is for older games only, never the one that just ended. | P2 |

### 6.2 Fair-play guard (FP)

Why: chess.com's Fair Play Policy says *"Do not use chess engines, software of any kind, bots, plugins, browser extensions, or any tools that analyze positions during play."* For Daily games it also forbids engine opinions on a game in progress. The policy does not apply to games against chess.com's bots. Chess.com closes accounts for violations, even in unrated games. The guard makes it impossible to break this by accident.

| ID | Requirement | Pri |
|---|---|---|
| FP-1 | On `in-progress-vs-human` and `unknown` pages, PonPon shows no engine output at all: no eval bar, no arrows, no labels, and no grades for earlier moves of the same game. The side panel shows "Game in progress. PonPon reviews it as soon as it ends." The engine doesn't run. | P0 |
| FP-2 | The guard unlocks only when a result is visible (1-0, 0-1, ½-½, or the game-over panel). Resigning, timing out, aborting and draws all count. | P0 |
| FP-3 | **Auto-review on game end:** when a game I was watching goes from in-progress to finished, PonPon starts the full review right away and opens the summary. (Setting, on by default.) | P0 |
| FP-4 | `bot-game` pages are fully live: suggestions, eval bar and per-move grades while I play. | P0 |
| FP-5 | While any chess.com tab has an in-progress game against a person, PonPon locks in every tab, including the analysis board and pasted PGNs. The service worker keeps per-tab state. | P1 |
| FP-6 | A test matrix (§10) covers every page type, plus the moment a game ends. It runs before every release. | P0 |

### 6.3 Engine (ENG)

| ID | Requirement | Pri |
|---|---|---|
| ENG-1 | Stockfish 19 via `nmrugg/stockfish.js` v19.0.1, **lite single-threaded build** (`stockfish-19-lite-single.js` + `.wasm`, about 1.7 MB, no cross-origin isolation needed). Bundled in the extension; no remote code. | P0 |
| ENG-2 | The engine runs in a Web Worker owned by the side panel. One engine instance with a job queue: review jobs and suggestion jobs. A new game cancels the old review. A position change cancels the old suggestion. | P0 |
| ENG-3 | Normalise every score to White's point of view (UCI scores are from the side to move). Keep mate scores as `{mate: n}` and never convert them to large centipawn numbers. | P0 |
| ENG-4 | Strength presets for review: **Fast** depth 12, **Normal** depth 16 (default), **Deep** depth 18. Fixed by M0's timings (`docs/perf.md`): about 2 s, 31 s and 52 s for a 40-move game in Chrome on my Mac. Depth 20 took 100 s, outside §9's review budget. | P0 |
| ENG-5 | The engine pauses when the side panel is hidden or the tab isn't chess.com, and resumes when it comes back (battery). | P0 |
| ENG-6 | The multi-threaded lite build behind a setting, with cross-origin isolation for extension pages via the manifest's `cross_origin_embedder_policy` and `cross_origin_opener_policy`. | P2 |

### 6.4 Move classification (CLS)

For a move by side S from position P to position P′:

- `cp` is the engine's evaluation from S's point of view. **Win%** = `50 + 50 × (2 / (1 + exp(−0.00368208 × cp)) − 1)` (Lichess's model). Mate for S = 100, mate against S = 0.
- `Wb` = Win% of P (the best line). `Wa` = Win% of P′ from S's point of view. **Drop** `Δ = max(0, Wb − Wa)`.
- **Move accuracy** = `clamp(103.1668 × exp(−0.04354 × Δ) − 3.1669, 0, 100)` (Lichess).
- Material counts P=1, N=3, B=3, R=5, Q=9.

Rules are checked in order and the first match wins. All thresholds live in `src/classify/thresholds.ts`. The side panel shows the English names by default (SET-1).

*Pon!* and *Bhale!* follow the common community definitions and are not tuned to match chess.com's labels: brilliant is a sound sacrifice that is the best or nearly the best move, and great is the only move that holds.

| # | Label (Kanglish) | ಕನ್ನಡ | English | Rule | Colour |
|---|---|---|---|---|---|
| 1 | **Pustaka** | ಪುಸ್ತಕ | Book | P′ is in the opening book and every earlier move was book | brown |
| 2 | **Pon!** | ಪೊನ್ | Brilliant | Δ < 2, **and** a sacrifice (after the first 4 plies of the engine's line from P′, S is down ≥ 2 points of material compared with P), **and** Wb ≤ 90 (not already won), **and** Wa ≥ 50 (sound) | gold |
| 3 | **Bhale!** | ಭಲೇ | Great (only move) | The played move is the engine's best, **and** the second-best move at P scores ≥ 10 Win% worse, **and** it isn't a recapture on the square of the opponent's last capture, **and** S had more than one legal move | teal |
| 4 | **Kai Jaaritu** | ಕೈ ಜಾರಿತು | Miss ("slipped from the hand") | The opponent's previous move was *Tappu* or *Ayyo*, **and** Δ ≥ 10 (S didn't punish it) | pink |
| 5 | **Sakkath** | ಸಖತ್ | Best | The played move equals the engine's best move, or Δ < 1, or it was the only legal move | green |
| 6 | **Chessnagide** | ಚೆಸ್ನಾಗಿದೆ | Excellent | Δ < 2 | light green |
| 7 | **Sari** | ಸರಿ | Good | 2 ≤ Δ < 5 | grey-green |
| 8 | **Swalpa** | ಸ್ವಲ್ಪ | Inaccuracy ("a little off") | 5 ≤ Δ < 10 | yellow |
| 9 | **Tappu** | ತಪ್ಪು | Mistake | 10 ≤ Δ < 15 | orange |
| 10 | **Ayyo** | ಅಯ್ಯೋ | Blunder | Δ ≥ 15 | red |

| ID | Requirement | Pri |
|---|---|---|
| CLS-1 | Labels 1, 5–10 as specified. | P0 |
| CLS-2 | *Pon!* and *Bhale!* (they need MultiPV 2 and the PV material check). | P0 |
| CLS-3 | *Kai Jaaritu*. | P1 |
| CLS-4 | Opening book from `lichess-org/chess-openings` (CC0), matched by position (EPD). Also gives the opening name for the summary. | P0 |
| CLS-5 | Golden tests: at least 30 hand-checked positions with an expected label each, including mate-for, mate-against, an only move, a recapture, a real sacrifice and a fake sacrifice (a piece that's taken back at once). | P0 |

### 6.5 Review and summary (REV)

| ID | Requirement | Pri |
|---|---|---|
| REV-1 | Evaluate every position P0…Pn at the chosen depth with MultiPV 2. Labels **stream in** in move order as each position finishes, so the first moves are graded within a few seconds. | P0 |
| REV-2 | Move list in the side panel: two columns (White / Black), each move with its label badge. Clicking a move selects it. | P0 |
| REV-3 | Selected-move card: "You played **Nf3** · *Swalpa* (−6%). Best was **d4** (+0.8)", the best line (first 6 plies), and evals before and after. "Show on board" draws the best move as an arrow (BRD-1). | P0 |
| REV-4 | Summary card: players, result, opening name, accuracy for each side, and label counts for each side. | P0 |
| REV-5 | Game accuracy: the mean of move accuracies, book moves excluded. | P0 |
| REV-6 | Lichess's game accuracy (volatility-weighted mean averaged with the harmonic mean) instead of the plain mean. | P1 |
| REV-7 | Eval graph across the whole game as an SVG line; click to jump to a move; label dots on the line. | P1 |
| REV-8 | Key moments: the 3 biggest drops for each side, linked to their moves. | P1 |

### 6.6 Next-move suggestions (SUG)

| ID | Requirement | Pri |
|---|---|---|
| SUG-1 | For the current position (selected ply on a finished game, the live position on the analysis board or in a bot game), run `go infinite` with MultiPV N (setting 1–3, default 3). | P0 |
| SUG-2 | Each line shows its eval (`+1.2`, `M3`), its first 8 plies in SAN, and its depth. The first result shows in under 1 s; it keeps refining until depth 22 or 15 s, then stops. | P0 |
| SUG-3 | UI updates are throttled to 4 per second. Lines don't reorder until their depth is ≥ 10, so they don't jump around. | P0 |
| SUG-4 | Eval bar for the current position (White's point of view, mate shown as `M3`). | P0 |
| SUG-5 | Clicking a line steps through it on a small board in the side panel (chessground). | P2 |

### 6.7 Board overlay (BRD)

| ID | Requirement | Pri |
|---|---|---|
| BRD-1 | Arrows on the chess.com board: the best move in gold, the 2nd and 3rd thinner and translucent. Drawn in an absolutely positioned SVG inside a shadow root, sized from the board's bounding box. `pointer-events: none` always. The arrows follow the suggestion lines live: they redraw at SUG-3's rate as the engine goes deeper and on every position change, and they clear while the guard is locked (FP-1). | P0 |
| BRD-2 | Correct after the board flips, resizes, the window resizes, or the layout changes (theatre mode, side panel open or closed). Uses `ResizeObserver` and the orientation from SRC-1. | P0 |
| BRD-3 | A label badge on the destination square of the selected move, as in chess.com's own review. | P1 |
| BRD-4 | Toggles: arrows on/off, badges on/off. A keyboard shortcut toggles arrows. | P0 |

### 6.8 Board sync (SYNC)

| ID | Requirement | Pri |
|---|---|---|
| SYNC-1 | When I step through moves on chess.com (arrow keys or clicks), the side panel selects the same ply within 200 ms. | P0 |
| SYNC-2 | Clicking a move in the side panel moves chess.com's board there, by clicking the matching node in chess.com's move list. | P1 |

### 6.9 Settings and onboarding (SET)

| ID | Requirement | Pri |
|---|---|---|
| SET-1 | Label language: **English** (default), **Kanglish**, or **ಕನ್ನಡ** (script). Hovering a label shows the other two names and what the Kanglish word means. | P0 |
| SET-2 | Review strength preset (ENG-4), suggestion lines (1–3), auto-review on game end (on), arrows (on), badges (on). | P0 |
| SET-3 | Clear cache, and show the cache's size. | P0 |
| SET-4 | First run: one screen explaining what PonPon does, when it's locked and why, and what the labels mean. | P0 |
| SET-5 | Noto Sans Kannada (OFL) bundled and subset to the label glyphs, so the script renders the same everywhere. | P0 |
| SET-6 | Sound effects: a short "Ayyo!" on a blunder and a chime on *Pon!*. Off by default. | P2 |

### 6.10 Data and privacy (DATA)

| ID | Requirement | Pri |
|---|---|---|
| DATA-1 | Settings in `chrome.storage.local`. Analyses in IndexedDB, keyed by `{game id or PGN hash, engine version, depth}`. Each entry holds each ply's FEN, eval, best move, PV and label. | P0 |
| DATA-2 | Cache limit of 500 games, least recently used evicted first. A reviewed game opens again instantly. | P0 |
| DATA-3 | No network requests except to chess.com pages already open (and the PubAPI, if SRC-6 is built). No analytics, no telemetry, no remote code. | P0 |
| DATA-4 | Permissions: `sidePanel`, `storage`; host permission `https://www.chess.com/*` only. | P0 |

### 6.11 Later ideas (not committed)

- **Ayyo drills:** turn my own blunders into puzzles.
- **Weekly report** across my recent games (needs SRC-6).
- **Plain-language "why"** for a selected move, via the Claude API with my own key. Opt-in, and the only feature that would send data off the machine.
- Lichess support.

## 7. Key user flows

1. **A game ends.** I resign or win. The result appears → FP-2 unlocks → FP-3 starts the review → labels stream into the side panel → the summary shows within about 60 s. I press ← on chess.com and the panel follows (SYNC-1) with the best-move arrow on the board.
2. **An old game.** I open a game from my archive and open PonPon (toolbar icon). It reviews the game, or shows it instantly if cached.
3. **Analysis board.** I set up or explore a position. Suggestions and arrows update with every move.
4. **A bot game.** I play a chess.com bot. Each move gets a grade as I play, and suggestions show for my turn.
5. **Paste.** I paste a PGN from anywhere and get the full review in the side panel (no board overlay).
6. **A live game against a person.** The panel says "Game in progress". Nothing else shows until it ends, then flow 1 runs.

## 8. Technical architecture

```
chess.com tab                         Service worker                 Side panel (extension page)
┌──────────────────────────┐   port   ┌─────────────────────┐  port  ┌───────────────────────────────┐
│ content script           │ ───────► │ routes messages     │ ─────► │ UI (plain TypeScript)         │
│  adapter: DOM → game     │ ◄─────── │ per-tab page state  │ ◄───── │ review pipeline + classifier  │
│  state (SRC-1/2/5)       │          │ global lock (FP-5)  │        │ Web Worker: Stockfish 19 WASM │
│  overlay: arrows, badges │          │ opens side panel    │        │ IndexedDB cache               │
│  (shadow root, BRD)      │          └─────────────────────┘        └───────────────────────────────┘
└──────────────────────────┘
```

- **Manifest V3.** `side_panel.default_path`; `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- **CSP:** `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` (needed to run WASM).
- **The fair-play decision is made in two places.** The content script classifies the page. The side panel refuses to start the engine unless the latest page state is unlocked. Neither trusts the other's cached state for more than one message.
- **Libraries:** `chess.js` (BSD-2) for legality, FEN and SAN; `stockfish.js` (GPL-3.0); `lichess-org/chess-openings` (CC0); `chessground` (GPL-3.0, P2 only). No UI framework: plain TypeScript and DOM APIs.
- **Build:** TypeScript, Vite, Vitest. DOM adapter tests run against saved chess.com HTML fixtures in happy-dom.
- **License:** Stockfish is GPL-3.0, so PonPon is **GPL-3.0**. The obligations only apply if it's shared, but the LICENSE file and an About-screen source link go in from the start.

## 9. Non-functional requirements

| Area | Target |
|---|---|
| Side panel open → interactive | ≤ 500 ms |
| First suggestion line | ≤ 1 s |
| Full review, 40-move game, Normal preset | ≤ 60 s on my Mac (M0 measured 31 s; `docs/perf.md`) |
| First labels visible after a review starts | ≤ 5 s |
| Memory, side panel + worker | ≤ 300 MB |
| CPU when idle or hidden | 0% (ENG-5) |
| Overlay accuracy | Arrow ends inside the right square at every board size from 300 to 1200 px, in both orientations |

## 10. Milestones (each with a verification step)

| M | Scope | Verify |
|---|---|---|
| **M0** Spike | (a) Adapter: read the move list, ply, orientation and state on the analysis board, a finished Live game, a finished Daily game, a bot game, and an in-progress Live game (state only, engine off). Save HTML fixtures for each. (b) Stockfish 19 lite single in a side-panel worker: measure nodes/s and per-position time at depths 12/16/20 | The adapter's SAN list matches the downloaded PGN for 5 of my games; the page-state classification is right on all 5 page types; timings are written to `docs/perf.md` and ENG-4's depths are fixed |
| **M1** Review MVP | SRC-1–5, FP-1–4 and FP-6, ENG-1–5, CLS-1, CLS-2, CLS-4, CLS-5, REV-1–5, DATA-1–4, paste PGN | 20 of my games reviewed; label agreement with chess.com's Game Review measured (§11); golden tests pass; the FP matrix passes: in-progress = nothing shown and engine idle; result appears = auto-review starts |
| **M2** Suggestions and board | SUG-1–4, BRD-1, BRD-2, BRD-4, SYNC-1 | Arrows land on the right squares in both orientations at 3 board sizes and after a resize; the panel follows arrow-key navigation; a full bot game played with live grades |
| **M3** Polish and v1.0 | SET-1–5, icons and a gold-pawn logo, About/GPL link, a README with the unpacked-install steps | A fresh Chrome profile loads the unpacked extension (chrome://extensions → Load unpacked) and reviews a game in ≤ 3 clicks; FP matrix re-run |
| **M4** v1.1 | CLS-3, REV-6–8, BRD-3, SYNC-2, FP-5 | Accuracy within ±3 of Lichess's on 10 games exported there; FP-5 locks the analysis board while another tab has a game in progress |

## 11. Success metrics

- **Label agreement:** on 20 of my games, ≥ 85% of moves land in the same category as chess.com's Game Review or one next to it. Chess.com's model is proprietary, so exact matches aren't the goal. Brilliant and Great are left out of this check, since they follow community definitions (§6.4).
- **Accuracy:** within ±5 points of chess.com's on ≥ 80% of those games (v1.0), and within ±3 of Lichess's (v1.1).
- **Speed:** the §9 targets hold on my Mac.
- **Safety:** zero engine output on in-progress games against people, across the FP matrix and a week of my own use.
- **Use:** I review most of my games with PonPon instead of chess.com's Game Review.

## 12. Risks

| Risk | Mitigation |
|---|---|
| chess.com changes its DOM and the adapter breaks | All selectors in one file; fixture tests; principle 1 ("can't read this page", not wrong data); PGN paste always works |
| The guard misreads a page and shows analysis during a live game | Unknown = locked; unlocking needs a visible result; FP matrix before every release; FP-5 as a second layer |
| PonPon's labels disagree with chess.com's and look wrong | Thresholds in one file and tuned on real games; the About screen says PonPon uses Lichess's Win% model |
| False *Pon!* labels (fake sacrifices) | Conservative rule (4-ply material check, Wb ≤ 90, Wa ≥ 50); golden tests include fake sacrifices |
| The engine is too slow on older laptops | Fast preset; streamed results; the threaded build later (ENG-6) |
| chess.com objects, or the Web Store rejects it if it's published later | Not published for now. No chess.com logos or branding in the UI; if published, the listing says "post-game analysis and practice" and describes the guard |
| GPL obligations if it's shared | LICENSE file and source link in place from day one |

## 13. Decisions and open questions

**Decided 2026-10-24**
- **Name:** PonPon, shown in Chrome as "PonPon – Chess Move Coach".
- **Platform:** Chrome, Manifest V3, chess.com only; UI in the side panel, plus a board overlay.
- **Scope:** analysis only. No engine output during in-progress games against people, Live or Daily. Bot games are live. Auto-review when a game ends.
- **Engine:** Stockfish 19 lite single-threaded, local. No server.
- **License:** GPL-3.0 (forced by Stockfish).
- **Labels:** English by default; the Kanglish and ಕನ್ನಡ sets in §6.4 are options (SET-1).
- **Distribution:** loaded unpacked for my own use. No Web Store for now.
- **UI:** plain TypeScript, no framework.
- **Brilliant and Great:** the common community definitions, not tuned to chess.com (§6.4).

**Still open:** nothing right now.

## Appendix A — Kanglish and ಕನ್ನಡ labels (optional, SET-1)

| Label | Means | Shown when |
|---|---|---|
| ಪೊನ್ **Pon!** | gold | Brilliant sacrifice |
| ಭಲೇ **Bhale!** | bravo | The only good move |
| ಸಖತ್ **Sakkath** | awesome | The engine's best |
| ಚೆಸ್ನಾಗಿದೆ **Chessnagide** | "it's good" (with chess inside) | Excellent |
| ಸರಿ **Sari** | okay, correct | Good |
| ಪುಸ್ತಕ **Pustaka** | book | Opening theory |
| ಸ್ವಲ್ಪ **Swalpa** | a little | Inaccuracy |
| ತಪ್ಪು **Tappu** | mistake | Mistake |
| ಕೈ ಜಾರಿತು **Kai Jaaritu** | slipped from the hand | Missed a win the opponent offered |
| ಅಯ್ಯೋ **Ayyo** | oh no | Blunder |
