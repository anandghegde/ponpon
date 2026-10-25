import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Uci } from '../src/engine/uci.ts';
import { SUGGEST_DEPTH, suggest, type Suggestion } from '../src/suggest/suggest.ts';

/** White: Kd1 Qd2; Black: Ke8 to move. Small enough for depth 22 in moments. */
const QUEEN_UP_BLACK_TO_MOVE = '4k3/8/8/8/8/8/3Q4/3K4 b - - 0 1';
/** Black's king on h8 in check from a rook on a8: only Kg7 and Kh7 are legal. */
const TWO_MOVES = 'R6k/8/8/8/8/8/1K6/8 b - - 0 1';

describe('suggestions under Node (SUG-1, SUG-2)', () => {
  let engine: { processCommand(cmd: string): void; terminate(): void };
  const uci = new Uci((cmd) => engine.processCommand(cmd));
  beforeAll(async () => {
    engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
    await uci.init({ Hash: 16 });
  });
  afterAll(() => engine.terminate());

  it('reports complete iterations, deeper each time, and stops itself at depth 22', async () => {
    const seen: Suggestion[] = [];
    const final = await suggest(uci, { sans: [], startFen: QUEEN_UP_BLACK_TO_MOVE }, 0, { multipv: 3, onLines: (s) => seen.push(s) });
    expect(seen.length).toBeGreaterThan(5);
    for (const s of seen) expect(s.lines).toHaveLength(3);
    const depths = seen.map((s) => s.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(new Set(depths).size).toBe(depths.length);
    expect(final).toBe(seen.at(-1));
    expect(final.depth).toBe(SUGGEST_DEPTH);
    // White's point of view: Black to move, a queen down.
    for (const line of final.lines) expect('mate' in line.score ? line.score.mate > 0 : line.score.cp > 500).toBe(true);
    for (const line of final.lines) expect(line.pv[0]).toMatch(/^e8/);
  });

  it("knows the game's moves, so it sees a repetition", async () => {
    // Black, a queen down, has seen the start position twice: bringing the knight back draws at once, and Black takes it.
    const sans = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'];
    const startFen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const final = await suggest(uci, { sans, startFen }, 7, { multipv: 1 });
    expect(final.lines[0].score).toEqual({ cp: expect.closeTo(0) });
    expect(final.lines[0].pv[0]).toBe('f6g8');
  });

  it('gives fewer lines when the position has fewer legal moves', async () => {
    const final = await suggest(uci, { sans: [], startFen: TWO_MOVES }, 0, { multipv: 3 });
    expect(final.lines.map((l) => l.pv[0]).sort()).toEqual(['h8g7', 'h8h7']);
  });

  it('stops when aborted, and the engine takes the next request', async () => {
    const job = new AbortController();
    const t0 = Date.now();
    const run = suggest(uci, { sans: [] }, 0, { multipv: 2, signal: job.signal, onLines: (s) => s.depth >= 8 && job.abort() });
    await expect(run).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
    await expect(uci.isReady()).resolves.toBe('readyok');
  });
});
