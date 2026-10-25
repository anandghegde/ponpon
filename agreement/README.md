# Label agreement with chess.com (PRD §11)

`npm run agreement` compares PonPon's labels with chess.com's Game Review, game by game.

Each game has up to three files here, named by its chess.com game id:

| File | What | Made by |
|---|---|---|
| `<id>.pgn` | The game, from the PubAPI | The script (`npm run agreement -- latest 20`, or on its own when a `.chesscom.txt` has no PGN yet) |
| `<id>.evals.json` | Stockfish at Normal (depth 16), MultiPV 2, every position | The script, once per game. The labels are graded again from it on every run, so a change to `src/classify/thresholds.ts` shows up at once |
| `<id>.chesscom.txt` | chess.com's labels and accuracies | You, after a Game Review on chess.com |

## `<id>.chesscom.txt`

One label per move, in game order, White's and Black's moves alternating. Move numbers and `#` comments are
ignored, and the accuracy line is optional:

```
# https://www.chess.com/game/live/185404401434
accuracy 81.2 74.5
1. book book
2. book best
3. excellent inaccuracy
...
```

Labels: `brilliant great best excellent good book inaccuracy mistake miss blunder`.

## How it counts

- **Agreement:** the same label, or the next one along `book · best · excellent · good · inaccuracy · mistake · blunder`.
  chess.com's *miss* counts as *mistake*. Moves that either side calls brilliant or great are left out (§11).
- **Accuracy:** within ±5 of chess.com's for both sides.
- Targets: agreement ≥ 85% over 20 games, accuracy close on ≥ 80% of them.
