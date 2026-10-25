import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PositionEval } from '../src/classify/classify.ts';
import { ReviewStore, STORE_LIMIT } from '../src/sidepanel/store.ts';

const positions = (fen: string): PositionEval[] => [{ fen, lines: [{ score: { cp: 20 }, pv: ['e2e4'] }] }];

describe('ReviewStore', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keys a review by engine, depth, start position and moves, and keeps it across panels', async () => {
    const factory = new IDBFactory();
    const store = await ReviewStore.open('sf-a', factory);
    const game = { sans: ['e4', 'e5'] };
    await store.put(game, 16, positions('p'));

    const again = await ReviewStore.open('sf-a', factory);
    expect(await again.get({ sans: ['e4', 'e5'] }, 16)).toEqual(positions('p'));
    expect(await again.get(game, 18)).toBeUndefined();
    expect(await again.get({ sans: ['e4'] }, 16)).toBeUndefined();
    expect(await again.get({ ...game, startFen: '8/8/8/8/8/8/8/K6k w - - 0 1' }, 16)).toBeUndefined();
    expect(await (await ReviewStore.open('sf-b', factory)).get(game, 16)).toBeUndefined();
  });

  it('replaces the shorter versions of a game that grew', async () => {
    const store = await ReviewStore.open('sf', new IDBFactory());
    await store.put({ sans: ['e4'] }, 16, positions('1'));
    await store.put({ sans: ['e4', 'e5'] }, 16, positions('2'));
    await store.put({ sans: ['d4'] }, 16, positions('other'));
    await store.put({ sans: ['e4', 'e5', 'Nf3'] }, 16, positions('3'));
    expect(await store.get({ sans: ['e4'] }, 16)).toBeUndefined();
    expect(await store.get({ sans: ['e4', 'e5'] }, 16)).toBeUndefined();
    expect(await store.get({ sans: ['e4', 'e5', 'Nf3'] }, 16)).toEqual(positions('3'));
    expect(await store.get({ sans: ['d4'] }, 16)).toEqual(positions('other'));
  });

  it('keeps 500 games and evicts the least recently used; opening a game counts as use', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
    const store = await ReviewStore.open('sf', new IDBFactory());
    const game = (i: number) => ({ sans: [`g${i}`] });
    for (let i = 0; i < STORE_LIMIT; i++) await store.put(game(i), 16, positions(`p${i}`));
    expect(await store.get(game(0), 16)).toEqual(positions('p0'));

    await store.put(game(STORE_LIMIT), 16, positions('new'));
    expect(await store.get(game(1), 16)).toBeUndefined();
    for (const i of [0, 2, STORE_LIMIT - 1, STORE_LIMIT]) expect(await store.get(game(i), 16)).toBeDefined();
  });
});
