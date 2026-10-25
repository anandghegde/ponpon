import { classifyPage, isUnlocked, type PageState } from './page-state.ts';
import { readGame, type GameRead } from './read.ts';

/** What the content script sends the side panel (SRC-5). A locked page (FP-1) sends no game at all. */
export interface PageSnapshot {
  url: string;
  state: PageState;
  game: GameRead | null;
  /** Why readGame failed on an unlocked page (principle 1: the panel asks for the PGN). */
  error: string | null;
}

export function snapshot(url: string, doc: Document): PageSnapshot {
  const state = classifyPage(url, doc);
  if (!isUnlocked(state)) return { url, state, game: null, error: null };
  try {
    return { url, state, game: readGame(doc), error: null };
  } catch (e) {
    return { url, state, game: null, error: String(e) };
  }
}
