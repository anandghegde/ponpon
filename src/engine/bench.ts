// M0(b) engine benchmark: per-position review time at fixed depths (ENG-4), and how fast suggestion lines arrive (SUG-2).
import type { Uci } from './uci.ts';

export const BENCH_OPTIONS = { Hash: 64, Threads: 1 };
const DEPTHS = [12, 16, 20];
const REVIEW_MULTIPV = 2;
/** P0…P80: the positions of a 40-move game, the size §9's review target is set for. */
const POSITIONS_40_MOVES = 81;
/** Opening, middlegame and endgame positions of the benchmark game. */
const SUGGEST_PLIES = [8, 30, 60];
const SUGGEST_MARKS = [10, 16, 22];
const SUGGEST_CAP_MS = 15_000;

export interface DepthRun {
  depth: number;
  /** Wall time per position. */
  ms: number[];
  nodes: number;
}

export interface SuggestRun {
  /** Milliseconds from `go` to the first scored line, and to the first line at each of SUGGEST_MARKS. */
  firstLine: number | null;
  toDepth: Partial<Record<number, number>>;
  depth: number;
  ms: number;
}

/** Analyses the positions in order with `go depth`, as a review would: one `ucinewgame`, so the hash carries over. */
export async function runDepth(
  uci: Uci,
  fens: string[],
  depth: number,
  multiPv: number,
  onPosition?: (done: number) => void,
): Promise<DepthRun> {
  uci.send(`setoption name MultiPV value ${multiPv}`);
  uci.send('ucinewgame');
  await uci.isReady();
  const run: DepthRun = { depth, ms: [], nodes: 0 };
  for (const fen of fens) {
    let nodes = 0;
    uci.send(`position fen ${fen}`);
    const t0 = performance.now();
    await uci.go(`depth ${depth}`, (info) => (nodes = info.nodes));
    run.ms.push(performance.now() - t0);
    run.nodes += nodes;
    onPosition?.(run.ms.length);
  }
  return run;
}

/** SUG-1/2 from a cold hash: MultiPV 3, `go infinite`, stopped once depth 22 is complete or after 15 s. */
export async function runSuggest(uci: Uci, fen: string): Promise<SuggestRun> {
  uci.send('setoption name MultiPV value 3');
  uci.send('ucinewgame');
  await uci.isReady();
  uci.send(`position fen ${fen}`);
  const run: SuggestRun = { firstLine: null, toDepth: {}, depth: 0, ms: 0 };
  let stopped = false;
  const stop = () => {
    if (!stopped) uci.send('stop');
    stopped = true;
  };
  const timer = setTimeout(stop, SUGGEST_CAP_MS);
  const t0 = performance.now();
  await uci.go('infinite', (info) => {
    const t = performance.now() - t0;
    run.firstLine ??= t;
    run.depth = Math.max(run.depth, info.depth);
    for (const d of SUGGEST_MARKS) if (info.depth >= d) run.toDepth[d] ??= t;
    if (info.depth >= SUGGEST_MARKS.at(-1)! && info.multipv === 3) stop();
  });
  clearTimeout(timer);
  run.ms = performance.now() - t0;
  return run;
}

/** Runs the whole benchmark on a fresh engine and returns the report as markdown. */
export async function runBench(uci: Uci, fens: string[], env: string, log: (msg: string) => void): Promise<string> {
  await uci.init(BENCH_OPTIONS);
  const depthRuns: DepthRun[] = [];
  for (const depth of DEPTHS) {
    depthRuns.push(await runDepth(uci, fens, depth, REVIEW_MULTIPV, (n) => log(`depth ${depth}: ${n}/${fens.length}`)));
  }
  const suggestRuns: [number, SuggestRun][] = [];
  for (const ply of SUGGEST_PLIES.filter((p) => p < fens.length)) {
    log(`suggestions: ply ${ply}`);
    suggestRuns.push([ply, await runSuggest(uci, fens[ply])]);
  }
  log('done');

  const options = Object.entries(BENCH_OPTIONS).map(([k, v]) => `${k} ${v}`).join(', ');
  return [
    `**${env}**, ${options}`,
    '',
    `Review: ${fens.length} positions in game order, \`go depth D\`, MultiPV ${REVIEW_MULTIPV}, one \`ucinewgame\` per depth.`,
    '',
    `| Depth | Total s | Mean ms | p50 ms | p90 ms | Max ms | kN/s | ${POSITIONS_40_MOVES}-position game s |`,
    '|---|---|---|---|---|---|---|---|',
    ...depthRuns.map(depthRow),
    '',
    `Suggestions: MultiPV 3, \`go infinite\` from a cold hash, stopped at depth ${SUGGEST_MARKS.at(-1)} or ${SUGGEST_CAP_MS / 1000} s.`,
    '',
    `| Ply | First line ms | ${SUGGEST_MARKS.map((d) => `Depth ${d} ms`).join(' | ')} | Depth reached | Total s |`,
    `|---|---|${SUGGEST_MARKS.map(() => '---|').join('')}---|---|`,
    ...suggestRuns.map(([ply, r]) => suggestRow(ply, r)),
  ].join('\n');
}

function depthRow(r: DepthRun): string {
  const sorted = [...r.ms].sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  const total = sorted.reduce((a, b) => a + b, 0);
  const mean = total / sorted.length;
  const ms = (x: number) => x.toFixed(0);
  return `| ${r.depth} | ${(total / 1000).toFixed(1)} | ${ms(mean)} | ${ms(pct(0.5))} | ${ms(pct(0.9))} | ${ms(sorted.at(-1)!)} | ${ms(r.nodes / total)} | ${((mean * POSITIONS_40_MOVES) / 1000).toFixed(1)} |`;
}

function suggestRow(ply: number, r: SuggestRun): string {
  const ms = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(0));
  return `| ${ply} | ${ms(r.firstLine)} | ${SUGGEST_MARKS.map((d) => ms(r.toDepth[d])).join(' | ')} | ${r.depth} | ${(r.ms / 1000).toFixed(1)} |`;
}
