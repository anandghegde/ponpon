# Engine performance (M0 spike, 2026-10-24)

The M0(b) measurement for ENG-4 and the §9 targets. The code is in `src/engine/bench.ts`. Both runners use the same WASM and the same positions:

- **Chrome:** the side panel (`npm run build`, load `dist/` unpacked, open the panel, Run). This run decides ENG-4. M1 replaced that page with the real panel; check out commit 695c47f to run it again.
- **Node:** `npm run bench:node`, a baseline to compare against.

## Setup

| | |
|---|---|
| Machine | Apple M4 Pro (10 performance cores), 24 GB, macOS 26.7.1 |
| Engine | Stockfish 19 lite single-threaded WASM (`stockfish` 19.0.1, `.wasm` 1.85 MB), `Hash 64`, `Threads 1` (this build's maximum) |
| Positions | P0…P91 of game 185404401434 (`test/fixtures/pgn/`), 92 positions, opening to mate |
| Review run | Positions in game order, `position fen` + `go depth D`, MultiPV 2, one `ucinewgame` per depth so the hash carries over, as it will in a review. The last column extrapolates the mean to the 81 positions of a 40-move game (§9) |
| Suggestion run | Plies 8, 30, 60 (opening, middlegame, endgame). `ucinewgame` first (cold hash), MultiPV 3, `go infinite`, `stop` once depth 22 is complete for all three lines or after 15 s (SUG-2). Times run from `go` to the first info line at that depth |

## Chrome (side panel)

The user's run from the side panel, 2026-10-24.

**Chrome 155.0.0.0, 14 logical cores**, Hash 64, Threads 1

| Depth | Total s | Mean ms | p50 ms | p90 ms | Max ms | kN/s | 81-position game s |
|---|---|---|---|---|---|---|---|
| 12 | 2.0 | 22 | 18 | 44 | 83 | 1322 | 1.8 |
| 16 | 35.6 | 387 | 245 | 838 | 3318 | 1189 | 31.3 |
| 20 | 113.8 | 1237 | 1006 | 2855 | 4910 | 1092 | 100.2 |

| Ply | First line ms | Depth 10 ms | Depth 16 ms | Depth 22 ms | Depth reached | Total s |
|---|---|---|---|---|---|---|
| 8 | 0 | 22 | 370 | 2708 | 23 | 2.8 |
| 30 | 0 | 6 | 327 | 15034 | 22 | 15.0 |
| 60 | 0 | 5 | 1416 | 4588 | 23 | 4.6 |

- **Chrome matches Node:** within 2% at depths 12 and 16, and 3.5% slower at depth 20. Node is a good stand-in for quick checks such as the depth-18 row below.
- "Depth reached 23" at plies 8 and 60 counts lines that arrived after `stop`, from the depth-23 iteration that had already started. The depth-22 column is the number that matters.
- At ply 30 the depth-22 time (15,034 ms) is later than the 15 s `stop`: it's the partial line Stockfish prints when it's stopped mid-iteration. In Chrome, depth 22 didn't finish there.

## Node baseline

The second of two runs, with nothing else running. The first run was within 2% everywhere.

**Node v26.5.0, Apple M4 Pro**, Hash 64, Threads 1

| Depth | Total s | Mean ms | p50 ms | p90 ms | Max ms | kN/s | 81-position game s |
|---|---|---|---|---|---|---|---|
| 12 | 2.1 | 22 | 18 | 44 | 94 | 1280 | 1.8 |
| 16 | 36.3 | 395 | 266 | 832 | 3254 | 1165 | 32.0 |
| 20 | 110.0 | 1195 | 975 | 2733 | 4651 | 1130 | 96.8 |
| 18 | 56.9 | 618 | 508 | 1130 | 3186 | 1157 | 50.1 |

Depth 18 was measured afterwards with `runDepth` alone (same options and positions), for the Deep decision.

| Ply | First line ms | Depth 10 ms | Depth 16 ms | Depth 22 ms | Depth reached | Total s |
|---|---|---|---|---|---|---|
| 8 | 0 | 24 | 390 | 2573 | 22 | 2.6 |
| 30 | 0 | 6 | 338 | 14436 | 22 | 15.0 |
| 60 | 0 | 5 | 1368 | 4350 | 22 | 4.3 |

## What the numbers say (Chrome)

- **Normal (depth 16) meets §9** with room to spare: 31 s for a 40-move game against the 60 s target.
- **Deep (depth 20) doesn't:** 100 s, 3× Normal. Depth 18 would take about 52 s (Node's 50 s plus Chrome's 3% at that depth). Fast (depth 12) takes under 2 s a game.
- **First labels ≤ 5 s holds:** a move's label needs the positions before and after it, and at depth 16 the p90 is 0.84 s per position. Single positions can take over 3 s, so expect the occasional stall.
- **First suggestion ≤ 1 s is the engine's easy part:** a depth-1 line arrives in under 1 ms, and depth 10 (SUG-3's reorder threshold) takes at most 22 ms. The 1 s budget goes to messaging and the UI.
- **Depth 22 within 15 s is borderline:** at ply 30 the 15 s cap stopped the search during the depth-22 iteration. On a slower machine suggestions will often stop at depth 20–21, which SUG-2 already allows.

## ENG-4 decision

Decided with the user on 2026-10-24: **Fast 12, Normal 16 (default), Deep 18**. All three fit the 60 s review budget in Chrome (about 2 s, 31 s and 52 s for a 40-move game). Depth 20 (100 s) was dropped as Deep because it's 3× Normal and outside the budget; a 60-move game would take 2.5 min. §9's Normal target stays at ≤ 60 s.
