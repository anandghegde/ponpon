// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyPage, type PageState } from '../src/adapter/page-state.ts';
import { readGame } from '../src/adapter/read.ts';
import * as S from '../src/adapter/selectors.ts';
import { replay, sansFromPgn } from '../src/game/replay.ts';

const FIXTURES = 'test/fixtures/chesscom';

function load(name: string): { url: string; doc: Document } {
  const html = readFileSync(`${FIXTURES}/${name}.html`, 'utf8');
  const url = /<!-- ponpon-fixture url=(\S+)/.exec(html)![1];
  return { url, doc: new DOMParser().parseFromString(html, 'text/html') };
}

function pgnTag(pgn: string, tag: string): string {
  return new RegExp(`\\[${tag} "([^"]*)"\\]`).exec(pgn)![1];
}

function placementAt(sans: string[], ply: number): string {
  return replay(sans)[ply].split(' ')[0];
}

describe('readGame matches the PubAPI PGN', () => {
  const games: [fixture: string, pgnId: string, me: 'white' | 'black' | null][] = [
    ['live-finished-185851072404', '185851072404', 'white'],
    ['live-finished-185404401434', '185404401434', 'white'],
    ['live-finished-185689081726', '185689081726', 'white'],
    ['live-finished-185251405966', '185251405966', 'black'],
    ['live-finished-185421044934', '185421044934', 'black'],
    ['daily-finished-1045360362', '1045360362', null],
  ];

  it.each(games)('%s', (fixture, pgnId, me) => {
    const pgn = readFileSync(`test/fixtures/pgn/${pgnId}.pgn`, 'utf8');
    const game = readGame(load(fixture).doc);
    expect(game.sans).toEqual(sansFromPgn(pgn));
    expect(game.result).toBe(pgnTag(pgn, 'Result'));
    expect(game.players).toEqual({ white: pgnTag(pgn, 'White'), black: pgnTag(pgn, 'Black') });
    if (me) expect(game.orientation).toBe(me);
    expect(game.ply).toBe(game.sans.length);
    expect(game.placement).toBe(placementAt(game.sans, game.ply!));
  });
});

describe('readGame on other pages', () => {
  it('reads the selected ply after stepping back', () => {
    const game = readGame(load('live-finished-185851072404-ply41').doc);
    expect(game.ply).toBe(41);
    expect(game.placement).toBe(placementAt(game.sans, 41));
  });

  it('reads the analysis board main line and selected move', () => {
    const game = readGame(load('analysis-mainline-selected').doc);
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(game.ply).toBe(6);
    expect(game.placement).toBe(placementAt(game.sans, 6));
    expect(game.result).toBeNull();
  });

  it('reports a selected side line as ply null and keeps it out of the main line', () => {
    const game = readGame(load('analysis-variation-selected').doc);
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(game.ply).toBeNull();
  });

  it.each([
    ['bot-inprogress', null],
    ['bot-finished', '0-1'],
  ])('reads a bot game: %s', (fixture, result) => {
    const game = readGame(load(fixture).doc);
    expect(game.sans).toEqual(['e4', 'c5', 'd4', 'cxd4', 'Nc3', 'Nh6', 'Qxd4', 'Ng4']);
    expect(game.players).toEqual({ white: 'bowod28216', black: 'Martinfoot' });
    expect(game.result).toBe(result);
    expect(game.placement).toBe(placementAt(game.sans, game.ply!));
  });

  it.each([
    ['live-inprogress-spectator-185854046964', 114, null],
    ['live-ended-while-watching-185854046964', 158, '0-1'],
    ['daily-inprogress-spectator-1046347836', 44, null],
  ])('reads a spectated game: %s', (fixture, plies, result) => {
    const game = readGame(load(fixture).doc);
    expect(game.sans).toHaveLength(plies);
    expect(game.result).toBe(result);
    expect(game.placement).toBe(placementAt(game.sans, game.ply!));
  });
});

describe('classifyPage', () => {
  const expected: Record<string, PageState> = {
    'analysis-mainline-selected': 'analysis',
    'analysis-variation-selected': 'analysis',
    'bot-inprogress': 'bot-game',
    'bot-finished': 'bot-game',
    'daily-finished-1045360362': 'finished-game',
    'daily-inprogress-spectator-1046347836': 'spectating',
    'live-ended-while-watching-185854046964': 'finished-game',
    'live-finished-185251405966': 'finished-game',
    'live-finished-185404401434': 'finished-game',
    'live-finished-185421044934': 'finished-game',
    'live-finished-185689081726': 'finished-game',
    'live-finished-185851072404': 'finished-game',
    'live-finished-185851072404-ply41': 'finished-game',
    'live-inprogress-spectator-185854046964': 'spectating',
  };

  it('covers every fixture', () => {
    const fixtures = readdirSync(FIXTURES).map(f => f.replace(/\.html$/, '')).sort();
    expect(Object.keys(expected).sort()).toEqual(fixtures);
  });

  it.each(Object.entries(expected))('%s → %s', (fixture, state) => {
    const { url, doc } = load(fixture);
    expect(classifyPage(url, doc)).toBe(state);
  });

  it('locks a game page once the result row is removed', () => {
    const { url, doc } = load('live-finished-185851072404');
    doc.querySelectorAll('.game-result').forEach(e => e.remove());
    expect(classifyPage(url, doc)).toBe('in-progress-vs-human');
  });

  it('reads /live/game/ID, where /game/ID redirects, as a game against a person', () => {
    const { doc } = load('live-finished-185851072404');
    const url = 'https://www.chess.com/live/game/185851072404';
    expect(classifyPage(url, doc)).toBe('finished-game');
    doc.querySelectorAll('.game-result').forEach(e => e.remove());
    expect(classifyPage(url, doc)).toBe('in-progress-vs-human');
  });

  it.each([
    ['https://www.chess.com/puzzles/rated', 'unsupported'],
    ['https://www.chess.com/home', 'unknown'],
    ['https://www.chess.com/game/computer/123', 'unknown'],
  ])('%s → %s', (url, state) => {
    const { doc } = load('live-finished-185851072404');
    expect(classifyPage(url, doc)).toBe(state);
  });

  it.each([
    ['one of the players is me (names compare without case)', (doc: Document) => {
      doc.querySelector(`${S.PLAYER_TOP} ${S.PLAYER_USERNAME}`)!.textContent = 'Bowod28216';
    }],
    ['I am logged out', (doc: Document) => doc.querySelector(S.MY_PROFILE_LINK)!.remove()],
    ["a player's name can't be read", (doc: Document) => doc.querySelector(`${S.PLAYER_BOTTOM} ${S.PLAYER_USERNAME}`)!.remove()],
  ])('counts a game in progress as mine when %s (FP-7)', (_, change) => {
    const { url, doc } = load('live-inprogress-spectator-185854046964');
    change(doc);
    expect(classifyPage(url, doc)).toBe('in-progress-vs-human');
  });

  it('never counts /play/online as spectating: my own games start there', () => {
    const { doc } = load('live-inprogress-spectator-185854046964');
    expect(classifyPage('https://www.chess.com/play/online', doc)).toBe('in-progress-vs-human');
  });

  it('is unknown on a game URL without a board', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(classifyPage('https://www.chess.com/game/live/1', doc)).toBe('unknown');
  });
});
