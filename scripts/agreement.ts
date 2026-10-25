// §11: how often PonPon's labels agree with chess.com's Game Review, and how close the accuracies are.
//   npm run agreement                 fetches missing PGNs, reviews new games, compares every game with chess.com labels
//   npm run agreement -- latest <n>   also adds my latest n games
// Each game lives in agreement/ as <id>.pgn, <id>.evals.json (the engine's output at Normal, made once) and
// <id>.chesscom.txt (chess.com's labels, see agreement/README.md). Labels are graded again from the stored
// evaluations on every run, so a change to thresholds.ts shows up without the engine.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Label, PositionEval } from '../src/classify/classify.ts';
import { Uci } from '../src/engine/uci.ts';
import { parsePgn } from '../src/game/replay.ts';
import { PRESETS, review, summarise } from '../src/review/review.ts';

const USER = 'bowod28216';
const DIR = 'agreement';
const DEPTH = PRESETS.normal;
/** chess.com's labels on PonPon's scale: the same or a neighbouring step counts as agreement. Book only borders Best. */
const SCALE: Record<string, number> = { book: -1, best: 0, excellent: 1, good: 2, inaccuracy: 3, mistake: 4, miss: 4, blunder: 5 };
/** Left out of the check (§11): they follow community definitions, not chess.com's. */
const LEFT_OUT = new Set(['brilliant', 'great']);

const [command, arg] = process.argv.slice(2);
const path = (id: string, ext: string) => `${DIR}/${id}.${ext}`;
const ids = (ext: string) =>
  readdirSync(DIR)
    .filter((f) => f.endsWith(`.${ext}`))
    .map((f) => f.slice(0, -ext.length - 1));

// 1. PGNs: my latest games on request, and any game that has chess.com labels but no PGN yet.
const wanted = command === 'latest' ? Number(arg) : 0;
const missing = new Set(ids('chesscom.txt').filter((id) => !existsSync(path(id, 'pgn'))));
if (wanted || missing.size) {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'ponpon-dev-script' } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };
  const { archives } = (await get(`https://api.chess.com/pub/player/${USER}/games/archives`)) as { archives: string[] };
  let seen = 0;
  for (const month of archives.toReversed()) {
    if (seen >= wanted && !missing.size) break;
    const { games } = (await get(month)) as { games: { url: string; pgn?: string; rules: string }[] };
    for (const g of games.toReversed()) {
      const id = g.url.split('/').at(-1)!;
      const labelled = missing.delete(id);
      const latest = !labelled && seen < wanted && g.rules === 'chess';
      if (latest) seen++;
      if ((labelled || latest) && g.pgn && !existsSync(path(id, 'pgn'))) writeFileSync(path(id, 'pgn'), g.pgn);
    }
  }
  if (missing.size) console.error(`Not in ${USER}'s archives: ${[...missing].join(', ')}`);
}

// 2. Evaluations, once per game.
const games = ids('pgn').map((id) => ({ id, ...parsePgn(readFileSync(path(id, 'pgn'), 'utf8')) }));
const todo = games.filter((g) => !existsSync(path(g.id, 'evals.json')));
if (todo.length) {
  const uci = new Uci((cmd) => engine.processCommand(cmd));
  const engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
  await uci.init({ Hash: 64, Threads: 1 });
  for (const [i, g] of todo.entries()) {
    process.stderr.write(`Reviewing ${g.id} (${i + 1}/${todo.length})\n`);
    const r = await review(uci, g, { depth: DEPTH });
    writeFileSync(path(g.id, 'evals.json'), JSON.stringify(r.positions));
  }
  engine.terminate();
}

// 3. Compare.
const offline = new Uci(() => {
  throw new Error('evaluations missing');
});
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const lines: string[] = [];
let [agreeAll, exactAll, countAll, closeGames, compared] = [0, 0, 0, 0, 0];
for (const g of games) {
  const positions: PositionEval[] = JSON.parse(readFileSync(path(g.id, 'evals.json'), 'utf8'));
  const r = await review(offline, g, { depth: DEPTH, cache: new Map(positions.map((p) => [p.fen, p])) });
  const s = summarise(r);
  if (!existsSync(path(g.id, 'chesscom.txt'))) {
    lines.push(`${g.id}: reviewed, no chess.com labels yet (PonPon accuracy ${s.accuracy.w?.toFixed(1)} / ${s.accuracy.b?.toFixed(1)})`);
    continue;
  }
  const theirs = parseLabels(readFileSync(path(g.id, 'chesscom.txt'), 'utf8'));
  if (theirs.labels.length !== r.moves.length) {
    lines.push(`${g.id}: ${theirs.labels.length} chess.com labels for ${r.moves.length} moves, skipped`);
    continue;
  }
  let [agree, exact, count] = [0, 0, 0];
  const off: string[] = [];
  for (const m of r.moves) {
    const ours: Label = m.label;
    const their = theirs.labels[m.ply];
    if (LEFT_OUT.has(ours) || LEFT_OUT.has(their)) continue;
    count++;
    if (ours === their) exact++;
    if (Math.abs(SCALE[ours] - SCALE[their]) <= 1) agree++;
    else off.push(`${Math.floor(m.ply / 2) + 1}${m.side === 'w' ? '.' : '…'}${m.san} ${ours}/${their}`);
  }
  [agreeAll, exactAll, countAll, compared] = [agreeAll + agree, exactAll + exact, countAll + count, compared + 1];
  const acc = theirs.accuracy && ([s.accuracy.w, s.accuracy.b] as const);
  const close = acc && acc.every((a, i) => a !== null && Math.abs(a - theirs.accuracy![i]) <= 5);
  if (close) closeGames++;
  lines.push(
    `${g.id}: agreement ${pct(agree / count)} (exact ${pct(exact / count)}, ${count} moves)` +
      (acc ? `, accuracy ${acc.map((a, i) => `${a?.toFixed(1)} vs ${theirs.accuracy![i]}`).join(', ')}` : '') +
      (off.length ? `\n  off by 2+ (PonPon/chess.com): ${off.join(', ')}` : ''),
  );
}
console.log(lines.join('\n'));
if (compared) {
  console.log(
    `\n${compared} games, ${countAll} moves: agreement ${pct(agreeAll / countAll)} (target ≥ 85%), exact ${pct(exactAll / countAll)}; ` +
      `accuracy within ±5 for both sides in ${closeGames}/${compared} games (target ≥ 80%).`,
  );
}

/** One label per move, in order. `#` starts a comment; move numbers (`12.`) are skipped; `accuracy <white> <black>` is optional. */
function parseLabels(text: string): { labels: string[]; accuracy: [number, number] | null } {
  const labels: string[] = [];
  let accuracy: [number, number] | null = null;
  for (const raw of text.split('\n')) {
    const words = raw.replace(/#.*/, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words[0] === 'accuracy') {
      accuracy = [Number(words[1]), Number(words[2])];
      continue;
    }
    for (const w of words) {
      if (/^\d+\.*$/.test(w)) continue;
      if (!(w in SCALE) && !LEFT_OUT.has(w)) throw new Error(`Unknown label "${w}" in: ${raw}`);
      labels.push(w);
    }
  }
  return { labels, accuracy };
}
