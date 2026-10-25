// @vitest-environment happy-dom
// FP-6: the fair-play matrix at the side panel. Every fixture page, the moment a game ends, and the ways round the
// guard (a paste, a tab switch, a page PonPon can't hear from). The engine is a fake that records each review.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as S from '../src/adapter/selectors.ts';
import { snapshot } from '../src/adapter/snapshot.ts';
import { replay } from '../src/game/replay.ts';
import type { Line, PositionEval } from '../src/classify/classify.ts';
import type { Game, GradedMove } from '../src/review/review.ts';
import {
  elsewhere,
  LIVE_MS,
  MISMATCH_GRACE_MS,
  Session,
  WATCHED_MS,
  type OtherTab,
  type Reviewer,
  type Source,
  type Suggester,
  type View,
} from '../src/sidepanel/session.ts';
import type { SuggestOptions } from '../src/suggest/suggest.ts';

type PageSource = Extract<Source, { kind: 'page' }>;

function page(fixture: string, url?: string, change?: (doc: Document) => void): PageSource {
  const html = readFileSync(`test/fixtures/chesscom/${fixture}.html`, 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  change?.(doc);
  return { kind: 'page', snapshot: snapshot(url ?? /<!-- ponpon-fixture url=(\S+)/.exec(html)![1], doc) };
}

/** A spectated fixture turned into a game I'm playing: my name on the top player. */
function playing(fixture: string): PageSource {
  return page(fixture, undefined, (doc) => {
    doc.querySelector(`${S.PLAYER_TOP} ${S.PLAYER_USERNAME}`)!.textContent = 'bowod28216';
  });
}

/** A page source whose game is changed by `edit`. */
function edited(fixture: string, edit: (game: NonNullable<PageSource['snapshot']['game']>) => void): PageSource {
  const source = page(fixture);
  edit(source.snapshot.game!);
  return source;
}

/** A fixture's page with chess.com's board at another position of the same game. */
function at(fixture: string, ply: number): PageSource {
  return edited(fixture, (g) => {
    g.ply = ply;
    g.placement = replay(g.sans)[ply].split(' ')[0];
  });
}

function setup() {
  const runs: {
    game: Game;
    signal: AbortSignal;
    opts: Parameters<Reviewer>[1];
    finish(moves?: GradedMove[], positions?: PositionEval[]): void;
  }[] = [];
  const reviewer: Reviewer = (game, opts) =>
    new Promise((resolve, reject) => {
      const { signal } = opts;
      runs.push({ game, signal: signal!, opts, finish: (moves = [], positions = []) => resolve({ positions, moves }) });
      signal!.addEventListener('abort', () => reject(signal!.reason));
    });
  const searches: { fen: string; opts: SuggestOptions; finish(): void }[] = [];
  const suggester: Suggester = (game, ply, opts) =>
    new Promise((resolve, reject) => {
      searches.push({ fen: replay(game.sans, game.startFen)[ply], opts, finish: () => resolve({ depth: 22, lines: [] }) });
      opts.signal!.addEventListener('abort', () => reject(opts.signal!.reason));
    });
  let view!: View;
  let views = 0;
  const session = new Session(reviewer, suggester, (v) => ((view = v), views++));
  return { session, runs, searches, view: () => view, views: () => views };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PGN = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';

afterEach(() => {
  vi.useRealTimers();
});

describe('FP matrix', () => {
  const inProgress = ['live-inprogress-spectator-185854046964', 'daily-inprogress-spectator-1046347836'];
  const open = [
    'analysis-mainline-selected',
    'analysis-variation-selected',
    'bot-inprogress',
    'bot-finished',
    'daily-finished-1045360362',
    'live-ended-while-watching-185854046964',
    'live-finished-185251405966',
    'live-finished-185404401434',
    'live-finished-185421044934',
    'live-finished-185689081726',
    'live-finished-185851072404',
    'live-finished-185851072404-ply41',
  ];

  it.each(inProgress)('%s, playing: nothing is read, shown or run', async (fixture) => {
    const source = playing(fixture);
    expect(source.snapshot.game).toBeNull();
    const { session, runs, view } = setup();
    session.setSource(source);
    await settle();
    expect(runs).toHaveLength(0);
    expect(view()).toMatchObject({ notice: 'in-progress', canPaste: false, target: null, moves: [], positions: [] });
    expect(session.paste(PGN)).not.toBeNull();
    await settle();
    expect(runs).toHaveLength(0);
  });

  it.each(open)('%s: the game is reviewed', async (fixture) => {
    const source = page(fixture);
    const { session, runs, view } = setup();
    session.setSource(source);
    await settle();
    expect(runs).toHaveLength(1);
    expect(runs[0].game.sans).toEqual(source.snapshot.game!.sans);
    expect(view()).toMatchObject({ notice: null, canPaste: true, status: 'reviewing' });
  });

  it('starts the review the moment the result appears (FP-2, FP-3)', async () => {
    const { session, runs, view } = setup();
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    await settle();
    expect(runs).toHaveLength(0);
    session.setSource(page('live-ended-while-watching-185854046964'));
    await settle();
    expect(runs).toHaveLength(1);
    expect(runs[0].game.sans).toHaveLength(158);
    expect(view().target).toMatchObject({ result: '0-1', pasted: false });
  });

  it('with auto-review off, a game that ends waits for the Review button (FP-3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { session, runs, view } = setup();
    session.setAutoReview(false);
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    vi.setSystemTime(Date.now() + WATCHED_MS);
    session.setSource(page('live-ended-while-watching-185854046964'));
    session.setSource(page('live-ended-while-watching-185854046964'));
    await settle();
    expect(runs).toHaveLength(0);
    expect(view()).toMatchObject({ held: true, status: 'idle', target: { result: '0-1' } });
    session.review();
    await settle();
    expect(runs).toHaveLength(1);
    expect(view()).toMatchObject({ held: false, status: 'reviewing' });

    // A finished game opened later is still reviewed straight away (PRD §7, flow 2).
    session.setSource(page('live-finished-185404401434'));
    await settle();
    expect(runs).toHaveLength(2);
  });

  it('with auto-review off, a finished game whose result row draws a moment after its moves is still reviewed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { session, runs, view } = setup();
    session.setAutoReview(false);
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    vi.setSystemTime(Date.now() + WATCHED_MS - 1);
    session.setSource(page('live-ended-while-watching-185854046964'));
    await settle();
    expect(runs).toHaveLength(1);
    expect(view().held).toBe(false);
  });

  it('stops the engine and clears the review when the tab switches to a live game', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185404401434'));
    await settle();
    runs[0].finish([{ ply: 0, san: 'e4', side: 'w', label: 'book', drop: 0, accuracy: 100 }]);
    await settle();
    expect(view()).toMatchObject({ status: 'done', moves: [{ san: 'e4' }] });
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    await settle();
    expect(view()).toMatchObject({ notice: 'in-progress', target: null, moves: [], status: 'idle' });

    session.setSource(page('daily-finished-1045360362'));
    await settle();
    session.setSource(playing('daily-inprogress-spectator-1046347836'));
    expect(runs[1].signal.aborted).toBe(true);
  });

  it.each([{ kind: 'connecting' }, { kind: 'no-reader' }] as Source[])('%o is locked', async (source) => {
    const { session, runs, view } = setup();
    session.setSource(source);
    expect(session.paste(PGN)).not.toBeNull();
    await settle();
    expect(runs).toHaveLength(0);
    expect(view().canPaste).toBe(false);
  });

  it.each([
    ['https://www.chess.com/home', 'unknown'],
    ['https://www.chess.com/puzzles/rated', 'unsupported'],
  ])('%s is locked (%s)', async (url, notice) => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185851072404', url));
    await settle();
    expect(runs).toHaveLength(0);
    expect(view()).toMatchObject({ notice, canPaste: false, target: null });
  });
});

describe('the position on the board (BRD-1)', () => {
  it("is evaluated first, and each position shows as soon as it's ready", async () => {
    const { session, runs, view } = setup();
    const source = page('live-finished-185851072404-ply41');
    session.setSource(source);
    await settle();
    expect(runs[0].opts.focus).toBe(41);
    const position = { fen: 'x', lines: [] };
    runs[0].opts.onPosition!(41, position);
    expect(view().positions[41]).toBe(position);
    expect(view().ply).toBe(41);
  });

  it('has no board position for a pasted game, whose last position comes first', async () => {
    const { session, runs, view } = setup();
    session.setSource({ kind: 'other-site' });
    session.paste(PGN);
    await settle();
    expect(runs[0].opts.focus).toBe(7);
    expect(view()).toMatchObject({ ply: null, current: 7 });
  });

  it('is evaluated next when the board moves to a position the review has not reached', async () => {
    const { session, runs } = setup();
    session.setSource(page('live-finished-185851072404-ply41'));
    await settle();
    runs[0].opts.onPosition!(41, { fen: 'x', lines: [] });
    runs[0].opts.onPosition!(10, { fen: 'y', lines: [] });
    session.setSource(at('live-finished-185851072404-ply41', 10));
    await settle();
    expect(runs).toHaveLength(1);
    session.setSource(at('live-finished-185851072404-ply41', 20));
    await settle();
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs[1].opts.focus).toBe(20);
  });
});

describe('watching a game (FP-7)', () => {
  it.each(['live-inprogress-spectator-185854046964', 'daily-inprogress-spectator-1046347836'])(
    "%s, someone else's game: reviewed live",
    async (fixture) => {
      const source = page(fixture);
      expect(source.snapshot.state).toBe('spectating');
      const { session, runs, view } = setup();
      session.setSource(source);
      await settle();
      expect(runs).toHaveLength(1);
      expect(view()).toMatchObject({ notice: null, canPaste: true, status: 'reviewing' });
    },
  );

  it('keeps the grades as the game grows, and holds nothing when it ends, even with auto-review off', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { session, runs, view } = setup();
    session.setAutoReview(false);
    session.setSource(page('live-inprogress-spectator-185854046964'));
    await settle();
    const sans = runs[0].game.sans;
    runs[0].finish(sans.map((san, ply) => ({ ply, san, side: ply % 2 ? 'b' : 'w', label: 'best', drop: 0, accuracy: 100 })));
    await settle();
    vi.setSystemTime(Date.now() + WATCHED_MS);
    session.setSource(page('live-ended-while-watching-185854046964'));
    await settle();
    expect(view()).toMatchObject({ held: false, status: 'reviewing', target: { result: '0-1' } });
    expect(view().moves.filter(Boolean)).toHaveLength(sans.length);
    expect(runs).toHaveLength(2);
  });
});

describe('another tab (FP-5)', () => {
  const tab = (snapshot: PageSource['snapshot'] | null, url = snapshot?.url ?? '', extra: Partial<OtherTab> = {}): OtherTab => ({
    url,
    snapshot,
    unread: false,
    discarded: false,
    ...extra,
  });

  it('locks while another tab has a game that may be mine', () => {
    expect(elsewhere([tab(playing('live-inprogress-spectator-185854046964').snapshot)])).toBe('game');
    expect(elsewhere([tab(page('live-inprogress-spectator-185854046964').snapshot)])).toBeNull();
    expect(elsewhere([tab(page('live-finished-185404401434').snapshot), tab(page('bot-inprogress').snapshot)])).toBeNull();
  });

  it("locks while a game page hasn't answered, and asks for a reload when it never will", () => {
    const game = 'https://www.chess.com/game/185901473052';
    expect(elsewhere([tab(null, game)])).toBe('game');
    expect(elsewhere([tab(null, game, { unread: true })])).toBe('unread');
    expect(elsewhere([tab(null, game, { unread: true, discarded: true })])).toBeNull();
    expect(elsewhere([tab(null, 'https://www.chess.com/home', { unread: true })])).toBeNull();
    expect(elsewhere([tab(null, 'https://www.chess.com/play/online/watch')])).toBeNull();
  });

  it('stops the review, hides the paste and refuses one, then resumes', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185404401434'));
    await settle();
    session.setElsewhere('game');
    expect(runs[0].signal.aborted).toBe(true);
    expect(view()).toMatchObject({ notice: 'elsewhere-game', canPaste: false, target: null });
    expect(session.paste(PGN)).not.toBeNull();
    session.setElsewhere(null);
    await settle();
    expect(runs).toHaveLength(2);
    expect(view()).toMatchObject({ notice: null, status: 'reviewing' });
  });

  it('locks a paste on another site too, and an in-progress tab keeps its own notice', async () => {
    const { session, runs, view } = setup();
    session.setSource({ kind: 'other-site' });
    session.setElsewhere('unread');
    expect(view()).toMatchObject({ notice: 'elsewhere-unread', canPaste: false });
    expect(session.paste(PGN)).not.toBeNull();
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    expect(view().notice).toBe('in-progress');
    await settle();
    expect(runs).toHaveLength(0);
  });
});

describe('paste (SRC-4)', () => {
  it('reviews a pasted PGN on a site other than chess.com', async () => {
    const { session, runs, view } = setup();
    session.setSource({ kind: 'other-site' });
    expect(view().notice).toBe('other-site');
    expect(session.paste(PGN)).toBeNull();
    await settle();
    expect(runs[0].game.sans).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(view()).toMatchObject({ notice: null, target: { white: 'Alice', black: 'Bob', result: '1-0', pasted: true } });
  });

  it('keeps the start position from a FEN header', async () => {
    const { session, runs } = setup();
    session.setSource({ kind: 'other-site' });
    session.paste('[SetUp "1"]\n[FEN "8/4P3/8/8/8/8/k7/7K w - - 0 1"]\n\n1. e8=Q Kb2 *');
    await settle();
    expect(runs[0].game).toEqual({ sans: ['e8=Q', 'Kb2'], startFen: '8/4P3/8/8/8/8/k7/7K w - - 0 1' });
  });

  it('reviews a FEN on its own', async () => {
    const { session, runs, view } = setup();
    session.setSource({ kind: 'other-site' });
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    expect(session.paste(`  ${fen}\n`)).toBeNull();
    await settle();
    expect(runs[0].game).toEqual({ sans: [], startFen: fen });
    expect(view().target).toMatchObject({ white: null, black: null, result: null, pasted: true });
  });

  it.each(['1. e4 e5 2. Kxe8', '', '  \n', 'hello'])("refuses %j", async (text) => {
    const { session, runs } = setup();
    session.setSource({ kind: 'other-site' });
    expect(session.paste(text)).toMatch(/can't read/);
    await settle();
    expect(runs).toHaveLength(0);
  });

  it('is hidden and stopped while the active tab has a live game', async () => {
    const { session, runs, view } = setup();
    session.setSource({ kind: 'other-site' });
    session.paste(PGN);
    await settle();
    session.setSource(playing('live-inprogress-spectator-185854046964'));
    expect(runs[0].signal.aborted).toBe(true);
    expect(view()).toMatchObject({ notice: 'in-progress', target: null });
  });

  it('gives way to a different game page, and can be closed', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185404401434'));
    session.paste(PGN);
    expect(view().target?.pasted).toBe(true);
    session.setSource(page('live-finished-185404401434'));
    expect(view().target?.pasted).toBe(true);
    session.setSource(page('live-finished-185251405966'));
    expect(view().target?.pasted).toBe(false);
    session.paste(PGN);
    session.closePaste();
    expect(view().target).toMatchObject({ pasted: false, white: expect.any(String) });
    await settle();
    expect(runs.at(-1)!.game.sans).toEqual(page('live-finished-185251405966').snapshot.game!.sans);
  });
});

describe('engine scheduling', () => {
  it('pauses while the panel is hidden and resumes when it is back (ENG-5)', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185404401434'));
    await settle();
    session.setVisible(false);
    expect(runs[0].signal.aborted).toBe(true);
    expect(view().status).toBe('paused');
    await settle();
    expect(runs).toHaveLength(1);
    session.setVisible(true);
    await settle();
    expect(runs).toHaveLength(2);
    expect(view().status).toBe('reviewing');
  });

  it('reviews the shown game again when the settings change', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('live-finished-185404401434'));
    await settle();
    runs[0].finish([{ ply: 0, san: 'e4', side: 'w', label: 'book', drop: 0, accuracy: 100 }]);
    await settle();
    session.restart();
    expect(view()).toMatchObject({ status: 'reviewing', moves: [], positions: [] });
    await settle();
    expect(runs).toHaveLength(2);
    expect(runs[1].game).toEqual(runs[0].game);
  });

  it('runs one review at a time, the next once the aborted one has settled', async () => {
    const { session, runs } = setup();
    session.setSource(page('live-finished-185404401434'));
    await settle();
    session.setSource(page('live-finished-185251405966'));
    session.setSource(page('live-finished-185421044934'));
    await settle();
    expect(runs).toHaveLength(2);
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs[1].game.sans).toEqual(page('live-finished-185421044934').snapshot.game!.sans);
  });

  it('keeps the grades of the moves two games share and drops the rest', async () => {
    const { session, runs, view } = setup();
    session.setSource(page('bot-inprogress'));
    await settle();
    const sans = runs[0].game.sans;
    runs[0].finish(sans.map((san, ply) => ({ ply, san, side: ply % 2 ? 'b' : 'w', label: 'best', drop: 0, accuracy: 100 })));
    await settle();
    session.setSource(
      edited('bot-inprogress', (g) => {
        g.sans = [...sans, 'Nf3'];
        g.ply = 9;
        g.placement = replay(g.sans)[9].split(' ')[0];
      }),
    );
    await settle();
    expect(runs).toHaveLength(2);
    expect(view().moves).toHaveLength(8);
    // The analysis line shares only 1.e4 with the bot game.
    session.setSource(page('analysis-mainline-selected'));
    expect(view().moves.map((m) => m.san)).toEqual(['e4']);
  });
});

describe('principle 1: never review the wrong position', () => {
  it("gives up on a page whose moves don't replay", async () => {
    const { session, runs, view } = setup();
    session.setSource(edited('bot-inprogress', (g) => (g.sans = ['e4', 'Ke7'])));
    await settle();
    expect(runs).toHaveLength(0);
    expect(view()).toMatchObject({ notice: 'unreadable', canPaste: true });
  });

  it('waits out a board that lags the move list, and gives up if it lasts', async () => {
    vi.useFakeTimers();
    const { session, runs, view } = setup();
    session.setSource(edited('bot-inprogress', (g) => (g.placement = '8/8/8/8/8/8/8/8')));
    await vi.advanceTimersByTimeAsync(MISMATCH_GRACE_MS - 1);
    expect(view().notice).toBeNull();
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(view().notice).toBe('unreadable');

    session.setSource(edited('bot-inprogress', (g) => (g.placement = '8/8/8/8/8/8/8/8')));
    session.setSource(page('bot-inprogress'));
    await vi.advanceTimersByTimeAsync(MISMATCH_GRACE_MS);
    expect(view().notice).toBeNull();
    expect(runs).toHaveLength(1);
  });
});

describe('suggestions (SUG-1, SUG-2, SUG-3)', () => {
  const REVIEW: Line[] = [
    { score: { cp: 20 }, pv: ['a2a3'] },
    { score: { cp: 10 }, pv: ['h2h3'] },
  ];
  const LIVE: Line[] = [
    { score: { cp: 30 }, pv: ['b2b3'] },
    { score: { cp: 25 }, pv: ['g2g3'] },
    { score: { cp: 5 }, pv: ['c2c3'] },
  ];
  const FIXTURE = 'live-finished-185851072404-ply41';
  const evals = (sans: string[]): PositionEval[] => replay(sans).map((fen) => ({ fen, lines: REVIEW, depth: 16 }));

  /** A finished game on the board at ply 41, its review done. */
  async function reviewed() {
    vi.useFakeTimers();
    const t = setup();
    t.session.setSource(page(FIXTURE));
    await vi.advanceTimersByTimeAsync(0);
    const positions = evals(t.runs[0].game.sans);
    t.runs[0].finish([], positions);
    await vi.advanceTimersByTimeAsync(0);
    return { ...t, positions };
  }

  it('wait for the review, then search the board position, the review lines showing until the search goes deeper', async () => {
    vi.useFakeTimers();
    const { session, runs, searches, view } = setup();
    session.setSource(page(FIXTURE));
    await vi.advanceTimersByTimeAsync(0);
    runs[0].opts.onPosition!(41, { fen: 'x', lines: REVIEW, depth: 16 });
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(0);
    expect(view().suggestion).toMatchObject({ fen: 'x', depth: 16, lines: REVIEW, searching: false });

    const positions = evals(runs[0].game.sans);
    runs[0].finish([], positions);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ fen: positions[41].fen, opts: { multipv: 3 } });
    expect(view().suggestion).toMatchObject({ depth: 16, lines: REVIEW, searching: true });
    searches[0].opts.onLines!({ depth: 14, lines: LIVE });
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(view().suggestion).toMatchObject({ depth: 16, lines: REVIEW });
    searches[0].opts.onLines!({ depth: 17, lines: LIVE });
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(view().suggestion).toMatchObject({ depth: 17, lines: LIVE, searching: true });
    searches[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(view().suggestion).toMatchObject({ depth: 17, lines: LIVE, searching: false });
  });

  it('reach the view at most 4 times a second (SUG-3)', async () => {
    const { searches, view, views } = await reviewed();
    const before = views();
    // A second of lines, one every 50 ms.
    for (let depth = 17; depth < 37; depth++) {
      searches[0].opts.onLines!({ depth, lines: LIVE });
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(views() - before).toBeLessThanOrEqual(5);
    await vi.advanceTimersByTimeAsync(LIVE_MS);
    expect(view().suggestion!.depth).toBe(36);
  });

  it('follow the board: a new position cancels the old search (ENG-2)', async () => {
    const { session, searches, view, positions } = await reviewed();
    session.setSource(at(FIXTURE, 40));
    expect(searches[0].opts.signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches[1].fen).toBe(positions[40].fen);
    expect(view()).toMatchObject({ current: 40, suggestion: { fen: positions[40].fen } });
  });

  it('give way to the review of a move just played', async () => {
    vi.useFakeTimers();
    const { session, runs, searches } = setup();
    session.setSource(page('bot-inprogress'));
    await vi.advanceTimersByTimeAsync(0);
    const sans = runs[0].game.sans;
    runs[0].finish([], evals(sans));
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(1);
    session.setSource(
      edited('bot-inprogress', (g) => {
        g.sans = [...sans, 'Nf3'];
        g.ply = 9;
        g.placement = replay(g.sans)[9].split(' ')[0];
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(searches[0].opts.signal!.aborted).toBe(true);
    expect(runs).toHaveLength(2);
    expect(searches).toHaveLength(1);
  });

  it("don't run where the game is over", async () => {
    vi.useFakeTimers();
    const { session, runs, searches, view } = setup();
    session.setSource({ kind: 'other-site' });
    session.paste(PGN);
    await vi.advanceTimersByTimeAsync(0);
    const positions = evals(runs[0].game.sans);
    positions[7] = { fen: positions[7].fen, lines: [], end: 'checkmate' };
    runs[0].finish([], positions);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(0);
    expect(view().suggestion).toMatchObject({ end: 'checkmate', lines: [] });
  });

  it('follow the position picked in a pasted game', async () => {
    vi.useFakeTimers();
    const { session, runs, searches, view } = setup();
    session.setSource({ kind: 'other-site' });
    session.paste(PGN);
    await vi.advanceTimersByTimeAsync(0);
    const positions = evals(runs[0].game.sans);
    runs[0].finish([], positions);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches[0].fen).toBe(positions[7].fen);
    session.pick(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches[1].fen).toBe(positions[2].fen);
    expect(view()).toMatchObject({ current: 2, ply: null });
  });

  it('stop while the panel is hidden, and search again when it is back unless the search had finished (ENG-5)', async () => {
    const { session, searches } = await reviewed();
    session.setVisible(false);
    expect(searches[0].opts.signal!.aborted).toBe(true);
    session.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(2);
    searches[1].finish();
    await vi.advanceTimersByTimeAsync(0);
    session.setVisible(false);
    session.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(searches).toHaveLength(2);
  });

  it('stop the moment another tab may have a game of mine (FP-5)', async () => {
    const { session, searches, view } = await reviewed();
    session.setElsewhere('game');
    expect(searches[0].opts.signal!.aborted).toBe(true);
    expect(view().suggestion).toBeNull();
  });

  it('show as many lines as the setting, and search again with that many', async () => {
    const { session, searches, view } = await reviewed();
    session.setLines(1);
    expect(searches[0].opts.signal!.aborted).toBe(true);
    expect(view().suggestion!.lines).toEqual(REVIEW.slice(0, 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(searches[1].opts.multipv).toBe(1);
  });
});
