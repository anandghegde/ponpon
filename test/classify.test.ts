import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inBook, openingName } from '../src/classify/book.ts';
import { classify, moveAccuracy, povScore, winPercent, type MoveFacts } from '../src/classify/classify.ts';
import { replay, sansFromPgn } from '../src/game/replay.ts';

describe('winPercent', () => {
  it('is 50 at equality and symmetric', () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    for (const cp of [35, 120, 480]) expect(winPercent({ cp }) + winPercent({ cp: -cp })).toBeCloseTo(100, 10);
  });

  it("follows Lichess's curve", () => {
    expect(winPercent({ cp: 300 })).toBeCloseTo(75.11, 2);
  });

  it('puts mates at the ends', () => {
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -1 })).toBe(0);
  });
});

describe('povScore', () => {
  it("flips Black's scores and leaves White's alone", () => {
    expect(povScore({ cp: 40 }, 'w')).toEqual({ cp: 40 });
    expect(povScore({ cp: 40 }, 'b')).toEqual({ cp: -40 });
    expect(povScore({ mate: -2 }, 'b')).toEqual({ mate: 2 });
  });
});

describe('moveAccuracy', () => {
  it('is 100 for no drop, falls with the drop and stops at 0', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 3);
    expect(moveAccuracy(10)).toBeCloseTo(63.58, 2);
    expect(moveAccuracy(100)).toBe(0);
  });
});

describe('classify', () => {
  const quiet: MoveFacts = {
    book: false,
    winBefore: 60,
    winAfter: 60,
    winSecond: 58,
    isBest: false,
    legalMoves: 30,
    recapture: false,
    materialLoss: 0,
  };
  const label = (f: Partial<MoveFacts>) => classify({ ...quiet, ...f });
  const dropped = (drop: number, f: Partial<MoveFacts> = {}) => label({ winAfter: 60 - drop, ...f });

  it('grades by the drop, each band closed below and open above', () => {
    expect(dropped(0.99)).toBe('best');
    expect(dropped(1)).toBe('excellent');
    expect(dropped(1.99)).toBe('excellent');
    expect(dropped(2)).toBe('good');
    expect(dropped(4.99)).toBe('good');
    expect(dropped(5)).toBe('inaccuracy');
    expect(dropped(10)).toBe('mistake');
    expect(dropped(14.99)).toBe('mistake');
    expect(dropped(15)).toBe('blunder');
    expect(dropped(60)).toBe('blunder');
  });

  it('treats a gain like no drop', () => {
    expect(label({ winAfter: 70 })).toBe('best');
  });

  it("calls the engine's move or the only legal move Best whatever the drop", () => {
    expect(dropped(3, { isBest: true })).toBe('best');
    expect(dropped(40, { legalMoves: 1 })).toBe('best');
  });

  it('puts Book first, up to a mistake', () => {
    expect(dropped(9.99, { book: true, isBest: true, winSecond: 0, materialLoss: 5 })).toBe('book');
    expect(dropped(10, { book: true })).toBe('mistake');
  });

  it('gives Great to the best move when the second-best is 10 Win% worse and no longer clearly winning', () => {
    expect(label({ isBest: true, winSecond: 50 })).toBe('great');
    expect(label({ isBest: true, winSecond: 50.01 })).toBe('best');
    expect(label({ isBest: true, winBefore: 100, winAfter: 100, winSecond: 74.99 })).toBe('great');
    expect(label({ isBest: true, winBefore: 100, winAfter: 100, winSecond: 75 })).toBe('best');
    expect(label({ isBest: true, winSecond: null })).toBe('best');
    expect(label({ isBest: true, winSecond: 20, recapture: true })).toBe('best');
    expect(label({ isBest: true, winSecond: 20, legalMoves: 1 })).toBe('best');
    expect(label({ isBest: false, winSecond: 20 })).toBe('best');
  });

  it('gives Brilliant only to a sound sacrifice that is (nearly) the best move', () => {
    expect(dropped(1.99, { materialLoss: 2 })).toBe('brilliant');
    expect(dropped(0, { materialLoss: 9, isBest: true, winSecond: 0 })).toBe('brilliant');
    expect(dropped(2, { materialLoss: 3 })).toBe('good');
    expect(dropped(0, { materialLoss: 1 })).toBe('best');
    expect(label({ winBefore: 90, winAfter: 90, materialLoss: 3 })).toBe('brilliant');
    expect(label({ winBefore: 90.01, winAfter: 90.01, materialLoss: 3 })).toBe('best');
    expect(label({ winBefore: 50.5, winAfter: 49.9, materialLoss: 3 })).toBe('best');
  });
});

describe('opening book', () => {
  const after = (sans: string[]) => replay(sans).at(-1)!;

  it('knows named lines and every position on the way to them', () => {
    expect(openingName(after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']))).toBe('Ruy Lopez');
    expect(inBook(after(['e4', 'e5', 'Nf3', 'Nc6']))).toBe(true);
  });

  it('matches by position, so transpositions count', () => {
    expect(inBook(after(['c4', 'e6', 'd4', 'Nf6']))).toBe(true);
    expect(after(['c4', 'e6', 'd4', 'Nf6']).split(' ')[0]).toBe(after(['d4', 'Nf6', 'c4', 'e6']).split(' ')[0]);
  });

  it('leaves the rest out', () => {
    expect(inBook(after(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']))).toBe(false);
    const fens = replay(sansFromPgn(readFileSync('test/fixtures/pgn/185404401434.pgn', 'utf8')));
    expect(inBook(fens[40])).toBe(false);
  });
});
