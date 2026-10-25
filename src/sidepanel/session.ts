// The side panel's state, kept free of the DOM and chrome.* so it can be tested: what the active tab shows, whether
// the fair-play guard lets the engine run, and the review in progress. main.ts feeds it events and renders each View.
import { isHumanGameUrl, isUnlocked } from '../adapter/page-state.ts';
import type { GameRead } from '../adapter/read.ts';
import type { PageSnapshot } from '../adapter/snapshot.ts';
import type { PositionEval } from '../classify/classify.ts';
import { validateFen } from 'chess.js';
import { parsePgn, replay } from '../game/replay.ts';
import type { Game, GradedMove, Review, ReviewOptions } from '../review/review.ts';

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
}

export type Reviewer = (game: Game, opts: Pick<ReviewOptions, 'signal' | 'onMove' | 'onPosition' | 'focus'>) => Promise<Review>;

/** How long the board may disagree with the move list before PonPon gives up on the page (principle 1). */
export const MISMATCH_GRACE_MS = 1000;

/**
 * FP-3: how long a game must show as in progress to count as one I was watching. A finished game's page draws its
 * move list a moment before its result row, and that isn't a game ending.
 */
export const WATCHED_MS = 3000;

export class Session {
  readonly #reviewer: Reviewer;
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
  /** The engine takes one review at a time; a new one starts once the aborted one has settled. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(reviewer: Reviewer, onView: (view: View) => void) {
    this.#reviewer = reviewer;
    this.#onView = onView;
  }

  get view(): View {
    return {
      notice: this.#notice(),
      canPaste: !this.#locked(),
      target: this.#shown,
      moves: this.#moves,
      positions: this.#positions,
      status: this.#status,
      held: this.#held && this.#shown === this.#page,
      ply: this.#shown && this.#shown === this.#page && this.#source.kind === 'page' ? (this.#source.snapshot.game?.ply ?? null) : null,
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
    if (!run) this.#stop();
    else if (!this.#job && this.#status !== 'done') this.#start(target);
    this.#onView(this.view);
  }

  #stop(): void {
    this.#job?.abort();
    this.#job = null;
    if (this.#status === 'reviewing') this.#status = 'paused';
  }

  #start(target: Target): void {
    const job = (this.#job = new AbortController());
    const { signal } = job;
    const s = this.#source;
    const focus = target === this.#page && s.kind === 'page' ? (s.snapshot.game?.ply ?? undefined) : undefined;
    this.#status = 'reviewing';
    this.#queue = this.#queue
      .catch(() => {})
      .then(async () => {
        // The guard is checked once more right before the engine starts (PRD §8).
        if (signal.aborted || this.#locked()) return;
        const r = await this.#reviewer(target.game, {
          signal,
          focus,
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
        this.#onView(this.view);
      })
      .catch((e: unknown) => {
        if (signal.aborted || this.#job !== job) return;
        console.error(e);
        this.#job = null;
        this.#status = 'failed';
        this.#onView(this.view);
      });
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
