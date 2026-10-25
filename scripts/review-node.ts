// Reviews a PGN under Node with the side panel's engine and classifier, and prints the graded moves as markdown.
// npm run review:node -- <file.pgn> [fast|normal|deep]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { LABEL_NAMES, type Label } from '../src/classify/classify.ts';
import { formatScore as score, Uci } from '../src/engine/uci.ts';
import { sansFromPgn } from '../src/game/replay.ts';
import { PRESETS, review, summarise, type Preset } from '../src/review/review.ts';

const [file, preset = 'normal'] = process.argv.slice(2);
const depth = PRESETS[preset as Preset];
if (!file || !depth) {
  console.error('usage: npm run review:node -- <file.pgn> [fast|normal|deep]');
  process.exit(1);
}
const pgn = readFileSync(file, 'utf8');
const tag = (name: string) => new RegExp(`\\[${name} "([^"]*)"\\]`).exec(pgn)?.[1] ?? '?';
const sans = sansFromPgn(pgn);

const uci = new Uci((cmd) => engine.processCommand(cmd));
const engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
await uci.init({ Hash: 64, Threads: 1 });
const t0 = performance.now();
const r = await review(uci, { sans }, { depth, onMove: (m) => process.stderr.write(`\r${m.ply + 1}/${sans.length}`) });
const seconds = (performance.now() - t0) / 1000;
process.stderr.write('\n');
engine.terminate();

const pct = (x: number | null) => (x === null ? '—' : x.toFixed(1));

const rows = r.moves.map((m) => {
  const before = r.positions[m.ply];
  const after = r.positions[m.ply + 1];
  const best = before.lines[0].pv[0];
  const bestSan = new Chess(before.fen).move(best).san;
  const evalAfter = after.end === 'checkmate' ? '#' : after.end === 'draw' ? '½' : score(after.lines[0].score);
  const num = `${Math.floor(m.ply / 2) + 1}${m.side === 'w' ? '.' : '…'}`;
  return `| ${num} | ${m.san} | ${LABEL_NAMES[m.label]} | ${m.drop.toFixed(1)} | ${evalAfter} | ${bestSan === m.san ? '' : `${bestSan} (${score(before.lines[0].score)})`} |`;
});
const s = summarise(r);
const counts = (side: 'w' | 'b') =>
  (Object.keys(LABEL_NAMES) as Label[])
    .filter((l) => s.counts[side][l])
    .map((l) => `${LABEL_NAMES[l]} ${s.counts[side][l]}`)
    .join(', ');

console.log(
  [
    `**${tag('White')} – ${tag('Black')} ${tag('Result')}**, ${s.opening ?? 'opening unknown'}. ` +
      `Depth ${depth} (${preset}), ${seconds.toFixed(1)} s.`,
    '',
    `| | Accuracy | Labels |`,
    `|---|---|---|`,
    `| White | ${pct(s.accuracy.w)} | ${counts('w')} |`,
    `| Black | ${pct(s.accuracy.b)} | ${counts('b')} |`,
    '',
    '| # | Move | Label | Δ | Eval after | Best (eval) |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n'),
);
