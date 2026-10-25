// The content script (SRC-1, SRC-5). While a side panel is connected it re-reads the page after every DOM change
// and sends the snapshot whenever it differs. It reads chess.com's DOM, never clones or changes it
// (docs/chesscom-dom.md); its only additions are the layer of arrows and badges (BRD-1, BRD-3) and clicks on
// chess.com's own move list when the panel selects a move (SYNC-2).
import { isUnlocked, type PageState } from '../adapter/page-state.ts';
import * as S from '../adapter/selectors.ts';
import { snapshot } from '../adapter/snapshot.ts';
import { draw, type Marks } from './overlay.ts';

/** What the side panel sends: the marks for the board, or a move to show (main line, 0-based). */
export interface PanelMessage {
  marks?: Marks;
  select?: number;
}

/** Reads at most this often; with the panel's own work it keeps SRC-5's 200 ms budget. */
const READ_MS = 100;

const ports = new Set<chrome.runtime.Port>();
let sent = '';
let timer: ReturnType<typeof setTimeout> | null = null;
const NONE: Marks = { arrows: [], badge: null };
let wanted = NONE;
let drawn = NONE;

/** The second half of the fair-play decision (PRD §8): the page itself must be unlocked for marks to show. */
function paint(state: PageState): void {
  const next = isUnlocked(state) ? wanted : NONE;
  if (next === drawn) return;
  drawn = next;
  draw(next);
}

function read(): void {
  timer = null;
  const now = snapshot(location.href, document);
  paint(now.state);
  const json = JSON.stringify(now);
  if (json === sent) return;
  sent = json;
  for (const port of ports) port.postMessage(now);
}

const observer = new MutationObserver(() => {
  timer ??= setTimeout(read, READ_MS);
});

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  const now = snapshot(location.href, document);
  sent = JSON.stringify(now);
  port.postMessage(now);
  port.onMessage.addListener((message: PanelMessage) => {
    if (message.marks) {
      wanted = message.marks.arrows.length || message.marks.badge ? message.marks : NONE;
      paint(snapshot(location.href, document).state);
    }
    if (message.select !== undefined) {
      document
        .querySelector<HTMLElement>(`${S.MOVE_NODE}[${S.MOVE_NODE_ATTR}="0-${message.select}"] ${S.MOVE_TEXT}`)
        ?.click();
    }
  });
  if (ports.size === 1) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (ports.size > 0) return;
    observer.disconnect();
    wanted = NONE;
    paint('unknown');
  });
});

// Tells an open side panel this page can be read, well before the tab's load event (chess.com pages load slowly).
// With no panel open nobody answers, which is fine.
chrome.runtime.sendMessage('ponpon:ready').catch(() => {});
