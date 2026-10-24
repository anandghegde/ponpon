import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { runDepth } from '../src/engine/bench.ts';
import { parseInfo, Uci } from '../src/engine/uci.ts';
import { replay } from '../src/game/replay.ts';

describe('parseInfo', () => {
  it('reads a MultiPV line', () => {
    const line =
      'info depth 12 seldepth 17 multipv 2 score cp -30 nodes 52698 nps 1121234 hashfull 4 time 47 pv e7e6 d2d4 d7d5';
    expect(parseInfo(line)).toEqual({
      depth: 12,
      multipv: 2,
      score: { cp: -30 },
      nodes: 52698,
      nps: 1121234,
      time: 47,
      pv: ['e7e6', 'd2d4', 'd7d5'],
    });
  });

  it('reads mate scores and bounds', () => {
    const line = 'info depth 20 seldepth 4 multipv 1 score mate -2 upperbound nodes 10 nps 5 time 2 pv a1a2';
    expect(parseInfo(line)).toMatchObject({ score: { mate: -2 }, bound: 'upper' });
  });

  it('reads the line Stockfish prints for a checkmated side', () => {
    expect(parseInfo('info depth 0 score mate 0')).toEqual({
      depth: 0,
      multipv: 1,
      score: { mate: 0 },
      nodes: 0,
      nps: 0,
      time: 0,
      pv: [],
    });
  });

  it('skips lines without a score', () => {
    for (const line of [
      'info string NNUE evaluation using nn-61e7af4bb97d.nnue',
      'info depth 5 currmove e2e4 currmovenumber 1',
      'bestmove e2e4 ponder e7e5',
    ]) {
      expect(parseInfo(line)).toBeNull();
    }
  });
});

describe('Uci', () => {
  it('catches an answer the engine sends synchronously', async () => {
    const uci: Uci = new Uci((cmd) => cmd === 'isready' && uci.receive('readyok'));
    await expect(uci.isReady()).resolves.toBe('readyok');
  });

  it('refuses a second request while one is pending', () => {
    const uci = new Uci(() => {});
    void uci.isReady();
    expect(() => uci.isReady()).toThrow(/pending/);
  });
});

describe('Stockfish 19 lite single under Node', () => {
  it('analyses positions at a fixed depth', async () => {
    const uci = new Uci((cmd) => engine.processCommand(cmd));
    const engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));
    try {
      await uci.init({ Hash: 16 });
      const fens = replay(['e4', 'e5', 'Nf3']);
      const run = await runDepth(uci, fens, 8, 2);
      expect(run.ms).toHaveLength(fens.length);
      expect(run.nodes).toBeGreaterThan(0);
    } finally {
      engine.terminate();
    }
  });
});
