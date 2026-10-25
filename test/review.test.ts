import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PositionEval } from '../src/classify/classify.ts';
import { Uci } from '../src/engine/uci.ts';
import { sansFromPgn } from '../src/game/replay.ts';
import { review, summarise, type GradedMove } from '../src/review/review.ts';

describe('review under Node', () => {
  let engine: { processCommand(cmd: string): void; terminate(): void };
  const uci = new Uci((cmd) => engine.processCommand(cmd));
  beforeAll(async () => {
    engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
    await uci.init({ Hash: 16 });
  });
  afterAll(() => engine.terminate());

  it("grades Scholar's mate, streaming the moves in order", async () => {
    const streamed: number[] = [];
    const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    const r = await review(uci, { sans }, { depth: 10, onMove: (m) => streamed.push(m.ply) });
    expect(streamed).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.positions).toHaveLength(8);
    expect(r.positions[7]).toEqual({ fen: expect.any(String), lines: [], end: 'checkmate' });
    const label = (ply: number) => r.moves[ply].label;
    expect([label(0), label(1)]).toEqual(['book', 'book']);
    expect(label(5)).toBe('blunder');
    // The knight attacks the queen, so every other move leaves White about −2: mate is the only move that holds.
    expect(label(6)).toBe('great');
    const s = summarise(r);
    expect(s.counts.b.blunder).toBe(1);
    expect(s.accuracy.w!).toBeGreaterThan(s.accuracy.b!);
  });

  it("keeps scores from White's point of view", async () => {
    const r = await review(uci, { sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'] }, { depth: 10 });
    // Black to move after 3…Nf6?? is getting mated: White's view says White mates.
    expect(r.positions[6].lines[0].score).toEqual({ mate: 1 });
  });

  it("gives the engine the game's moves, so it sees a repetition", async () => {
    // Black, a queen down, has seen the start position twice: bringing the knight back draws at once, and Black takes it.
    const startFen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const r = await review(uci, { sans: ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'], startFen }, { depth: 10 });
    expect(r.positions[7].lines[0].score).toEqual({ cp: expect.closeTo(0) });
    expect(r.positions[7].lines[0].pv[0]).toBe('f6g8');
  });

  it('stops on abort, and a second run with the same cache resumes', async () => {
    const sans = sansFromPgn(readFileSync('test/fixtures/pgn/185404401434.pgn', 'utf8')).slice(0, 16);
    const cache = new Map<string, PositionEval>();
    const ctl = new AbortController();
    const first: GradedMove[] = [];
    const aborted = review(uci, { sans }, {
      depth: 12,
      cache,
      signal: ctl.signal,
      onMove: (m) => {
        first.push(m);
        if (m.ply === 3) ctl.abort();
      },
    });
    await expect(aborted).rejects.toThrow(/abort/i);
    expect(cache.size).toBe(5);
    const kept = [...cache.values()];

    const r = await review(uci, { sans }, { depth: 12, cache });
    expect(r.moves).toHaveLength(16);
    expect(r.positions.slice(0, 5)).toEqual(kept);
    expect(r.positions.slice(0, 5).every((p, i) => p === kept[i])).toBe(true);
    expect(r.moves.slice(0, 4)).toEqual(first);
  });

  it('evaluates the position on the board first, and still grades in order', async () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'];
    const order: number[] = [];
    const streamed: number[] = [];
    await review(uci, { sans }, { depth: 8, focus: 6, onPosition: (i) => order.push(i), onMove: (m) => streamed.push(m.ply) });
    expect(order.slice(0, 3)).toEqual([6, 5, 0]);
    expect(streamed).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('grades a fully cached game without the engine', async () => {
    const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    const cache = new Map<string, PositionEval>();
    const r = await review(uci, { sans }, { depth: 10, cache });
    const untouchable = new Uci(() => {
      throw new Error('engine used');
    });
    expect(await review(untouchable, { sans }, { depth: 10, cache })).toEqual(r);
  });
});
