// Records the engine's output for the golden positions (CLS-5) at Normal, so test/golden.test.ts runs without the
// engine. Positions already recorded are kept; run it after adding a case.   npm run record:golden
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { povScore, winPercent, type PositionEval } from '../src/classify/classify.ts';
import { formatScore, Uci } from '../src/engine/uci.ts';
import { PRESETS, review } from '../src/review/review.ts';
import { GOLDEN, GOLDEN_EVALS } from '../test/golden-cases.ts';

const old: PositionEval[] = existsSync(GOLDEN_EVALS) ? JSON.parse(readFileSync(GOLDEN_EVALS, 'utf8')) : [];
const cache = new Map(old.map((p) => [p.fen, p]));
const uci = new Uci((cmd) => engine.processCommand(cmd));
const engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
await uci.init({ Hash: 64, Threads: 1 });

const used = new Map<string, PositionEval>();
for (const c of GOLDEN) {
  const r = await review(uci, { sans: c.moves, startFen: c.fen }, { depth: PRESETS.normal, cache });
  for (const p of r.positions) if (!p.end) used.set(p.fen, p);
  const m = r.moves.at(-1)!;
  const before = r.positions[m.ply];
  const after = r.positions[m.ply + 1];
  const san = (pv: string[]) => new Chess(before.fen).move(pv[0]).san;
  const win = (p: PositionEval, i = 0) => winPercent(povScore(p.lines[i].score, m.side)).toFixed(0);
  const [best, second] = before.lines;
  console.log(
    `${m.label === c.label ? 'ok  ' : 'DIFF'} ${c.name}: ${m.label}${m.label === c.label ? '' : ` (expected ${c.label})`}, ` +
      `Δ ${m.drop.toFixed(1)}, Wb ${win(before)} → Wa ${after.end ?? win(after)}; ` +
      `best ${san(best.pv)} ${formatScore(best.score)}` +
      (second ? `, 2nd ${san(second.pv)} ${formatScore(second.score)} (${win(before, 1)})` : ''),
  );
}
engine.terminate();
writeFileSync(GOLDEN_EVALS, JSON.stringify([...used.values()].sort((a, b) => (a.fen < b.fen ? -1 : 1)), null, 0) + '\n');
