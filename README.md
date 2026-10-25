# PonPon – Chess Move Coach

*Turn every pawn into gold.* A Chrome extension that reviews your chess.com games with Stockfish 19 running on your own computer. Every move gets a label, the best moves show as arrows on chess.com's board, and live suggestions follow the position you're looking at. Unlimited, and nothing leaves your computer.

## Install (unpacked)

You need Node.js 24 or later and Chrome.

```sh
git clone https://github.com/anandghegde/ponpon.git
cd ponpon
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `dist/` folder.
3. Pin PonPon from the puzzle-piece menu so its gold pawn sits in the toolbar.

Open a finished game on chess.com and click the pawn: the side panel opens and reviews the game.

After pulling changes, run `npm run build` again and press the reload button on PonPon's card in `chrome://extensions`, then reload any open chess.com tabs.

## What it does

- **Reviews** finished games, Live or Daily, as soon as the result appears: a label for every move, accuracy for each side, the opening, and what the best move was.
- **Suggests** the best 1–3 lines for the position on the board, getting deeper while you look, with an eval bar.
- **Draws on the board:** gold arrows for the best moves, a green arrow for what was better than the move just played, and a badge (!!, !, ?!, ?, ??) on the square the move went to.
- **Follows the board:** press ← or → on chess.com and the panel follows; click a move in the panel and the board goes there.
- **Paste** a PGN or FEN from anywhere and get the same review.
- **Labels in English, Kanglish or ಕನ್ನಡ** (Settings). Hover a label to see its other names.

## The fair-play lock

While you're playing a person, Live or Daily, PonPon shows nothing and its engine stays off. chess.com's Fair Play Policy bans engines during play and closes accounts for it. PonPon unlocks when the result appears. Bot games, the analysis board and games you're only watching aren't locked. If a game of yours is in progress in another tab, PonPon stays off everywhere until it ends.

## Settings

Labels, review strength (Fast, Normal, Deep), suggestion lines (1–3), review on game end, arrows and badges, and the stored reviews (with a Clear button). **Alt+Shift+A** (⌥⇧A on a Mac) turns the arrows on and off; change it at `chrome://extensions/shortcuts`.

## Development

```sh
npm run build        # dist/ (copies Stockfish into public/engine first)
npm run typecheck
npm run review:node -- game.pgn normal   # review a PGN under Node
```

`docs/PRD.md` is the spec; `docs/chesscom-dom.md` describes the chess.com pages PonPon reads.

The Kannada font is Noto Sans Kannada cut down to the label glyphs. After changing a Kannada label, cut it again with fonttools from the variable font pinned to `wdth=100`:

```sh
pyftsubset NotoSansKannada-wdth100.ttf --text='<every Kannada label>' \
  --unicodes='U+0CBC-0CCD,U+0CD5-0CD6,U+200C-200D,U+25CC' --layout-features='*' \
  --flavor=woff2 --output-file=public/fonts/noto-sans-kannada-labels.woff2
```

The vowel-sign range matters: ೊ, ೋ and ೈ are shaped from parts that aren't in the labels themselves.

## License

GPL-3.0 (see `LICENSE`), because Stockfish is GPL-3.0. It also uses chess.js (BSD-2-Clause), lichess-org/chess-openings (CC0) and Noto Sans Kannada (SIL Open Font License 1.1, `public/fonts/OFL.txt`).
