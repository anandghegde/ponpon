import * as S from './selectors.ts';

export type PageState =
  | 'analysis'
  | 'finished-game'
  | 'bot-game'
  /** A game against a person in progress, mine or someone else's (FP-7). */
  | 'live-game'
  | 'unsupported'
  | 'unknown';

const UNSUPPORTED = /^\/(variants|puzzles?|lessons?)(\/|$)/;
const ANALYSIS = /^\/analysis(\/|$)/;
const BOT = /^\/play\/computer\/?$/;
/**
 * Games against people: /game/live/ID, /game/daily/ID, /game/ID, and /live/game/ID (where
 * /game/ID redirects once the game is over, at least when logged out). /play/online is unverified.
 */
const HUMAN_GAME = /^\/(game\/(live\/|daily\/)?\d+|live\/game\/\d+|play\/online)\/?$/;

/** The pages where the engine may run (FP-1, FP-4, FP-7). Everything else is locked, `unknown` included (principle 2). */
export function isUnlocked(state: PageState): boolean {
  return state === 'analysis' || state === 'finished-game' || state === 'bot-game' || state === 'live-game';
}

/**
 * SRC-2. Anything PonPon doesn't positively recognise is 'unknown', which is locked (principle 2).
 * A game against a person counts as finished only once the result row is in the move list; before that,
 * mine or anyone's, it is a live game (FP-7).
 */
export function classifyPage(url: string, doc: Document): PageState {
  const path = new URL(url).pathname;
  if (UNSUPPORTED.test(path)) return 'unsupported';
  if (!doc.querySelector(S.BOARD)) return 'unknown';
  if (ANALYSIS.test(path)) return 'analysis';
  if (BOT.test(path)) return 'bot-game';
  if (HUMAN_GAME.test(path)) {
    if (doc.querySelector(`:is(${S.MOVE_LIST}) ${S.GAME_RESULT}`)?.textContent?.trim()) return 'finished-game';
    return 'live-game';
  }
  return 'unknown';
}
