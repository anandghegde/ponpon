// Builds src/classify/book.json (CLS-4) from lichess-org/chess-openings (CC0), pinned to one commit.
// Every position on every line is book, keyed by EPD; a position that ends a line carries that opening's name.
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { epd } from '../src/game/replay.ts';

const COMMIT = 'a6189a30dc273ccb21fc2536a9a2fefd5592a67a';

const book = new Map<string, string>();
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/${COMMIT}/${file}.tsv`);
  if (!res.ok) throw new Error(`${file}.tsv: HTTP ${res.status}`);
  for (const row of (await res.text()).trim().split('\n').slice(1)) {
    const [, name, pgn] = row.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    for (const move of chess.history({ verbose: true })) if (!book.has(epd(move.after))) book.set(epd(move.after), '');
    if (!book.get(epd(chess.fen()))) book.set(epd(chess.fen()), name);
  }
}
const lines = [...book].map(([key, name]) => `${JSON.stringify(key)}:${JSON.stringify(name)}`);
writeFileSync('src/classify/book.json', `{\n${lines.join(',\n')}\n}\n`);
console.log(`${book.size} positions, ${[...book.values()].filter(Boolean).length} named`);
