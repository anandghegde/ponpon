// The side panel's state, kept free of the DOM and chrome.* so it can be tested: what the active tab shows, whether
// the fair-play guard lets the engine run, the review in progress, and the live suggestions for the position the
// panel describes. main.ts feeds it events and renders each View.
import { isHumanGameUrl, isUnlocked } from '../adapter/page-state.ts';
import type { GameRead } from '../adapter/read.ts';
import type { PageSnapshot } from '../adapter/snapshot.ts';
import type { Line, PositionEval } from '../classify/classify.ts';
import { validateFen } from 'chess.js';
import { parsePgn, replay } from '../game/replay.ts';
import type { Game, GradedMove, Review, ReviewOptions } from '../review/review.ts';
import type { Suggestion, SuggestOptions } from '../suggest/suggest.ts';

export type Source =
  | { kind: 'page'; snapshot: PageSnapshot }
  /** Waiting for a chess.com tab's content script to answer. Locked until it does (principle 2). */
  | { kind: 'connecting' }
  /** A chess.com tab whose content script doesn't answer, e.g. one opened before PonPon was loaded. */
  | { kind: 'no-reader' }
  /** The active tab isn't chess.com. */
  | { kind: 'other-site' };

/**
 * FP-5: what another chess.com tab says about the whole browser. `game`: a game I'm playing, or might be, is in
 * progress there. `unread`: a game page whose content script doesn't answer, so PonPon can't tell.
 */
export type Elsewhere = 'game' | 'unread' | null;

/** A chess.com tab other than the active one, as main.ts sees it. */
export interface OtherTab {
  url: string;
  /** Its latest snapshot; null until its content script answers. */
  snapshot: PageSnapshot | null;
  /** Its content script didn't answer: a tab opened before PonPon was loaded. */
  unread: boolean;
  /** Chrome has unloaded it to save memory; nothing runs in it. */
  discarded: boolean;
}

export function elsewhere(tabs: OtherTab[]): Elsewhere {
  const live = tabs.filter((t) => !t.discarded);
  if (live.some((t) => t.snapshot?.state === 'in-progress-vs-human')) return 'game';
  // A game page that hasn't answered yet may be mine; one that never answers can't be checked at all.
  if (live.some((t) => !t.snapshot && !t.unread && isHumanGameUrl(t.url))) return 'game';
  if (live.some((t) => t.unread && isHumanGameUrl(t.url))) return 'unread';
  return null;
}

/** Why the panel shows no review. `unreadable` and `other-site` invite a paste. */
export type Notice =
  | 'in-progress'
  | 'elsewhere-game'
  | 'elsewhere-unread'
  | 'unknown'
  | 'unsupported'
  | 'no-reader'
  | 'unreadable'
  | 'other-site';

export interface Target {
  game: Game;
  white: string | null;
  black: string | null;
  result: string | null;
  pasted: boolean;
}

export interface View {
  notice: Notice | null;
  /** Only where the engine may run, so a paste can't get round the guard (FP-1). */
  canPaste: boolean;
  target: Target | null;
  /** By ply. Holes are moves not graded yet. */
  moves: GradedMove[];
  positions: PositionEval[];
  status: 'idle' | 'reviewing' | 'paused' | 'done' | 'failed';
  /** FP-3 with auto-review off: the game that just ended waits for review(). */
  held: boolean;
  /** The position on chess.com's board (plies from the start) when the page's game is shown; null on a side line. */
  ply: number | null;
  /** The position the panel describes: `ply` for the page's game, the one picked in the panel for a pasted game. */
  current: number | null;
  /** SUG-1, SUG-2, SUG-4: the engine's lines for the current position, once the review has reached it. */
  suggestion: Lines | null;
}

export interface Lines {
  fen: string;
  /** The review's depth, until the live search goes deeper. */
  depth: number;
  /** Best first, at most the lines setting (SUG-1). Empty when the game is over in this position. */
  lines: Line[];
  end?: PositionEval['end'];
  /** The live search is still going deeper (SUG-2). */
  searching: boolean;
}

export type Reviewer = (game: Game, opts: Pick<ReviewOptions, 'signal' | 'onMove' | 'onPosition' | 'focus'>) => Promise<Review>;
/** Searches the position after `ply` moves of `game` (SUG-1). */
export type Suggester = (game: Game, ply: number, opts: SuggestOptions) => Promise<Suggestion>;
type Live = Suggestion & { fen: string; done: boolean };

/** SUG-3: live lines reach the view at most 4 times a second. */
export const LIVE_MS = 250;

/** How long the board may disagree with the move list before PonPon gives up on the page (principle 1). */
export const MISMATCH_GRACE_MS = 1000;

/**
 * FP-3: how long a game must show as in progress to count as one I was watching. A finished game's page draws its
 * move list a moment before its result row, and that isn't a game ending.
 */
export const WATCHED_MS = 3000;

export class Session {
  readonly #reviewer: Reviewer;
  readonly #suggester: Suggester;
  readonly #onView: (view: View) => void;
  #source: Source = { kind: 'connecting' };
  #visible = true;
  #page: Target | null = null;
  #pagePath: string | null = null;
  #unreadable = false;
  #mismatch: ReturnType<typeof setTimeout> | undefined;
  #pasted: Target | null = null;
  #autoReview = true;
  #held = false;
  #elsewhere: Elsewhere = null;
  /** When the page now in progress was first seen that way. */
  #inProgressSince = 0;
  #shown: Target | null = null;
  #moves: GradedMove[] = [];
  #positions: PositionEval[] = [];
  #status: View['status'] = 'idle';
  #job: AbortController | null = null;
  /** The position the running review evaluates first. */
  #focus: number | undefined;
  /** The engine takes one job at a time; a new one starts once the aborted one has settled. */
  #queue: Promise<unknown> = Promise.resolve();
  /** SUG-1's setting. */
  #lines = 3;
  /** The position picked in the panel for a pasted game; null means its last position. */
  #picked: number | null = null;
  /** The live search's latest complete iteration, for one position. */
  #live: Live | null = null;
  #suggesting: AbortController | null = null;
  #liveTimer: ReturnType<typeof setTimeout> | undefined;
  #liveAt = 0;

  constructor(reviewer: Reviewer, suggester: Suggester, onView: (view: View) => void) {
    this.#reviewer = reviewer;
    this.#suggester = suggester;
    this.#onView = onView;
  }

  get view(): View {
    const current = this.#current();
    return {
      notice: this.#notice(),
      canPaste: !this.#locked(),
      target: this.#shown,
      moves: this.#moves,
      positions: this.#positions,
      status: this.#status,
      held: this.#held && this.#shown === this.#page,
      ply: this.#shown && this.#shown === this.#page ? current : null,
      current,
      suggestion: this.#suggestion(current),
    };
  }

  setSource(source: Source): void {
    clearTimeout(this.#mismatch);
    const path = source.kind === 'page' ? new URL(source.snapshot.url).pathname : null;
    const previous = path === this.#pagePath ? this.#page : null;
    const was = this.#source;
    const wasInProgress =
      was.kind === 'page' && was.snapshot.state === 'in-progress-vs-human' && path === new URL(was.snapshot.url).pathname;
    if (source.kind === 'page' && source.snapshot.state === 'in-progress-vs-human' && !wasInProgress) {
      this.#inProgressSince = Date.now();
    }
    const ended =
      wasInProgress &&
      source.kind === 'page' &&
      isUnlocked(source.snapshot.state) &&
      Date.now() - this.#inProgressSince >= WATCHED_MS;
    if (ended) this.#held = !this.#autoReview;
    else if (path !== this.#pagePath) this.#held = false;
    this.#source = source;
    this.#page = null;
    this.#unreadable = false;
    if (source.kind === 'page' && isUnlocked(source.snapshot.state)) {
      // A different page drops a pasted game, so the panel follows the board (and FP-3's review takes over).
      if (path !== this.#pagePath) this.#pasted = null;
      this.#pagePath = path;
      const game = source.snapshot.game;
      const check = game ? readable(game) : 'no';
      if (check === 'yes') this.#page = pageTarget(game!);
      else if (check === 'no') this.#unreadable = true;
      else {
        // The board can lag the move list for a moment. Keep what's shown unless the mismatch lasts.
        this.#page = previous;
        this.#mismatch = setTimeout(() => {
          this.#page = null;
          this.#unreadable = true;
          this.#update();
        }, MISMATCH_GRACE_MS);
      }
    }
    this.#update();
  }

  /** FP-5: locks the panel, pastes included, while another tab may have a game of mine in progress. */
  setElsewhere(elsewhere: Elsewhere): void {
    if (elsewhere === this.#elsewhere) return;
    this.#elsewhere = elsewhere;
    this.#update();
  }

  /** FP-3's setting. */
  setAutoReview(on: boolean): void {
    this.#autoReview = on;
  }

  /** Starts the review of a game held by FP-3's setting. */
  review(): void {
    this.#held = false;
    this.#update();
  }

  /** The review settings changed: review the shown game again. */
  restart(): void {
    this.#stop();
    this.#moves = [];
    this.#positions = [];
    this.#status = 'idle';
    this.#update();
  }

  /** ENG-5: the engine stops while the panel is hidden, and resumes from the cache when it's back. */
  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#update();
  }

  /** SUG-1's setting: how many lines (1–3). The live search starts again with that many. */
  setLines(n: number): void {
    this.#lines = n;
    this.#stopSuggesting();
    this.#live = null;
    this.#update();
  }

  /** Picks the position a pasted game shows; chess.com's board picks it for the page's game. */
  pick(index: number): void {
    if (!this.#shown?.pasted) return;
    this.#picked = index;
    this.#update();
  }

  /** SRC-4: a PGN, or a FEN on its own. Returns why the paste was refused, or null when its review has started. */
  paste(text: string): string | null {
    if (this.#locked()) return 'PonPon is off on this page.';
    let parsed: ReturnType<typeof parsePgn>;
    try {
      parsed = parsePaste(text);
    } catch {
      return "PonPon can't read that PGN or FEN.";
    }
    const { White, Black, Result } = parsed.headers;
    this.#pasted = {
      game: { sans: parsed.sans, startFen: parsed.startFen },
      white: White && White !== '?' ? White : null,
      black: Black && Black !== '?' ? Black : null,
      result: Result && Result !== '*' ? Result : null,
      pasted: true,
    };
    this.#picked = null;
    this.#update();
    return null;
  }

  closePaste(): void {
    this.#pasted = null;
    this.#update();
  }

  #locked(): boolean {
    const s = this.#source;
    if (this.#elsewhere) return true;
    if (s.kind === 'other-site') return false;
    return s.kind !== 'page' || !isUnlocked(s.snapshot.state);
  }

  #notice(): Notice | null {
    const s = this.#source;
    if (s.kind === 'page' && s.snapshot.state === 'in-progress-vs-human') return 'in-progress';
    if (this.#elsewhere) return `elsewhere-${this.#elsewhere}`;
    if (s.kind === 'connecting') return null;
    if (s.kind === 'no-reader') return 'no-reader';
    if (s.kind === 'other-site') return this.#pasted ? null : 'other-site';
    if (s.snapshot.state === 'unknown' || s.snapshot.state === 'unsupported') return s.snapshot.state;
    return this.#unreadable && !this.#pasted ? 'unreadable' : null;
  }

  #update(): void {
    const target = this.#locked() ? null : (this.#pasted ?? this.#page);
    if (!sameGame(target, this.#shown)) {
      this.#stop();
      // Keep the grades of the moves both games share (a bot game that grew by a move), drop the rest.
      const keep = target && this.#shown ? sharedPlies(target.game, this.#shown.game) : -1;
      this.#moves.length = Math.max(0, Math.min(this.#moves.length, keep));
      this.#positions.length = Math.max(0, Math.min(this.#positions.length, keep + 1));
      this.#status = 'idle';
    }
    this.#shown = target;
    const run = target !== null && this.#visible && !(this.#held && target === this.#page);
    const current = this.#current();
    if (!run) {
      this.#stop();
      this.#stopSuggesting();
    } else if (this.#status !== 'done') {
      // The review comes first (ENG-2). When the board moves to a position the review hasn't reached, it goes next.
      this.#stopSuggesting();
      if (this.#job && current !== null && current !== this.#focus && !this.#positions[current]) this.#stop();
      if (!this.#job) this.#start(target, current);
    } else this.#suggest(current);
    this.#onView(this.view);
  }

  #stop(): void {
    this.#job?.abort();
    this.#job = null;
    if (this.#status === 'reviewing') this.#status = 'paused';
  }

  #start(target: Target, focus: number | null): void {
    const job = (this.#job = new AbortController());
    const { signal } = job;
    const first = (this.#focus = focus ?? undefined);
    this.#status = 'reviewing';
    this.#queue = this.#queue
      .catch(() => {})
      .then(async () => {
        // The guard is checked once more right before the engine starts (PRD §8).
        if (signal.aborted || this.#locked()) return;
        const r = await this.#reviewer(target.game, {
          signal,
          focus: first,
          // A cached position can still come through after an abort; it belongs to the old game.
          onPosition: (index, position) => {
            if (this.#job !== job) return;
            this.#positions[index] = position;
            this.#onView(this.view);
          },
          onMove: (move) => {
            if (this.#job !== job) return;
            this.#moves[move.ply] = move;
            this.#onView(this.view);
          },
        });
        if (this.#job !== job) return;
        this.#job = null;
        this.#moves = r.moves;
        this.#positions = r.positions;
        this.#status = 'done';
        // The live search takes over (SUG-1).
        this.#update();
      })
      .catch((e: unknown) => {
        if (signal.aborted || this.#job !== job) return;
        console.error(e);
        this.#job = null;
        this.#status = 'failed';
        this.#onView(this.view);
      });
  }

  /** SUG-1: once the review is done, the live search runs on the current position, unless it already has. */
  #suggest(current: number | null): void {
    const p = current === null ? undefined : this.#positions[current];
    const game = this.#shown?.game;
    if (!p || p.end || !game) return this.#stopSuggesting();
    if (this.#live?.fen === p.fen && (this.#suggesting || this.#live.done)) return;
    this.#stopSuggesting();
    const live: Live = { fen: p.fen, depth: 0, lines: [], done: false };
    this.#live = live;
    const job = (this.#suggesting = new AbortController());
    const { signal } = job;
    this.#queue = this.#queue
      .catch(() => {})
      .then(async () => {
        if (signal.aborted || this.#locked()) return;
        await this.#suggester(game, current!, {
          multipv: this.#lines,
          signal,
          onLines: (s) => {
            if (this.#suggesting !== job) return;
            Object.assign(live, s);
            this.#emitLive();
          },
        });
      })
      .catch((e: unknown) => {
        if (!signal.aborted) console.error(e);
      })
      .finally(() => {
        if (this.#suggesting !== job) return;
        this.#suggesting = null;
        // A search that failed counts as done too, so it isn't started again on every update.
        live.done = true;
        this.#onView(this.view);
      });
  }

  #stopSuggesting(): void {
    this.#suggesting?.abort();
    this.#suggesting = null;
  }

  #emitLive(): void {
    if (this.#liveTimer !== undefined) return;
    this.#liveTimer = setTimeout(
      () => {
        this.#liveTimer = undefined;
        this.#liveAt = Date.now();
        this.#onView(this.view);
      },
      Math.max(0, this.#liveAt + LIVE_MS - Date.now()),
    );
  }

  #current(): number | null {
    const shown = this.#shown;
    if (shown && shown === this.#pasted) return this.#picked ?? shown.game.sans.length;
    return shown && shown === this.#page && this.#source.kind === 'page' ? (this.#source.snapshot.game?.ply ?? null) : null;
  }

  #suggestion(current: number | null): Lines | null {
    const p = current === null ? undefined : this.#positions[current];
    if (!p) return null;
    const live = this.#live?.fen === p.fen ? this.#live : null;
    const deeper = live && live.depth > (p.depth ?? 0) ? live : null;
    return {
      fen: p.fen,
      depth: deeper?.depth ?? p.depth ?? 0,
      lines: (deeper ?? p).lines.slice(0, this.#lines),
      end: p.end,
      searching: !!live && this.#suggesting !== null && !live.done,
    };
  }
}

function parsePaste(text: string): ReturnType<typeof parsePgn> {
  const fen = text.trim();
  if (validateFen(fen).ok) return { sans: [], startFen: fen, headers: {} };
  const parsed = parsePgn(text);
  if (!parsed.sans.length && !parsed.startFen) throw new Error('Nothing to review');
  return parsed;
}

/** Principle 1: the moves must replay, and the board must show the position at the selected ply. */
function readable(game: GameRead): 'yes' | 'no' | 'mismatch' {
  let fens: string[];
  try {
    fens = replay(game.sans);
  } catch {
    return 'no';
  }
  return game.ply === null || fens[game.ply].split(' ')[0] === game.placement ? 'yes' : 'mismatch';
}

function pageTarget(game: GameRead): Target {
  return { game: { sans: game.sans }, ...game.players, result: game.result, pasted: false };
}

function sameGame(a: Target | null, b: Target | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a.game) === JSON.stringify(b.game));
}

/** How many moves from the start two games share; -1 when they start from different positions. */
function sharedPlies(a: Game, b: Game): number {
  if (a.startFen !== b.startFen) return -1;
  let n = 0;
  while (n < a.sans.length && n < b.sans.length && a.sans[n] === b.sans[n]) n++;
  return n;
}
