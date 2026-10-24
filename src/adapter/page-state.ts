import * as S from './selectors.ts';

export type PageState = 'analysis' | 'finished-game' | 'bot-game' | 'in-progress-vs-human' | 'unsupported' | 'unknown';

const UNSUPPORTED = /^\/(variants|puzzles?|lessons?)(\/|$)/;
const ANALYSIS = /^\/analysis(\/|$)/;
const BOT = /^\/play\/computer\/?$/;
/** Games against people: /game/live/ID, /game/daily/ID, /game/ID (seen while spectating). /play/online is unverified. */
const HUMAN_GAME = /^\/(game\/(live\/|daily\/)?\d+|play\/online)\/?$/;

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
    return doc.querySelector(`:is(${S.MOVE_LIST}) ${S.GAME_RESULT}`)?.textContent?.trim()
      ? 'finished-game'
      : 'in-progress-vs-human';
  }
  return 'unknown';
}
