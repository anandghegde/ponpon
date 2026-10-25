import * as S from './selectors.ts';

export type PageState =
  | 'analysis'
  | 'finished-game'
  | 'bot-game'
  /** A game against a person in progress that I'm watching: I'm logged in and neither player is me. */
  | 'spectating'
  /** A game against a person in progress that I'm playing, or might be. */
  | 'in-progress-vs-human'
  | 'unsupported'
  | 'unknown';

const UNSUPPORTED = /^\/(variants|puzzles?|lessons?)(\/|$)/;
const ANALYSIS = /^\/analysis(\/|$)/;
const BOT = /^\/play\/computer\/?$/;
/**
 * Games against people: /game/live/ID, /game/daily/ID, /game/ID (seen while spectating), and /live/game/ID (where
 * /game/ID redirects once the game is over, at least when logged out). /play/online is unverified.
 */
const HUMAN_GAME = /^\/(game\/(live\/|daily\/)?\d+|live\/game\/\d+|play\/online)\/?$/;

/** The pages where the engine may run (FP-1, FP-4, FP-7). Everything else is locked, `unknown` included (principle 2). */
export function isUnlocked(state: PageState): boolean {
  return state === 'analysis' || state === 'finished-game' || state === 'bot-game' || state === 'spectating';
}

/** A URL where a game against a person can be in progress, whatever its page shows (FP-5). */
export function isHumanGameUrl(url: string): boolean {
  return HUMAN_GAME.test(new URL(url).pathname);
}

/**
 * SRC-2. Anything PonPon doesn't positively recognise is 'unknown', which the fair-play guard treats as
 * locked (principle 2). A game against a person counts as finished only once the result row is in the
 * move list; the game-over modal alone doesn't unlock it.
 */
export function classifyPage(url: string, doc: Document): PageState {
  const path = new URL(url).pathname;
  if (UNSUPPORTED.test(path)) return 'unsupported';
  if (!doc.querySelector(S.BOARD)) return 'unknown';
  if (ANALYSIS.test(path)) return 'analysis';
  if (BOT.test(path)) return 'bot-game';
  if (HUMAN_GAME.test(path)) {
    if (doc.querySelector(`:is(${S.MOVE_LIST}) ${S.GAME_RESULT}`)?.textContent?.trim()) return 'finished-game';
    // /play/online is where my own games start: never a game I'm only watching.
    return !path.startsWith('/play/') && watching(doc) ? 'spectating' : 'in-progress-vs-human';
  }
  return 'unknown';
}

/** FP-7: I'm logged in, both players' names are read, and neither is mine. Anything unread counts as playing. */
function watching(doc: Document): boolean {
  const me = /\/member\/([^/?#]+)/.exec(doc.querySelector(S.MY_PROFILE_LINK)?.getAttribute('href') ?? '')?.[1];
  const players = [S.PLAYER_TOP, S.PLAYER_BOTTOM].map((box) =>
    doc.querySelector(`${box} ${S.PLAYER_USERNAME}`)?.textContent?.trim().toLowerCase(),
  );
  return !!me && players.every((p) => p && p !== me.toLowerCase());
}
