// The side panel: follows the content script in this window's active tab, reviews in a Stockfish Web Worker (ENG-2),
// renders the Session, and sends the board's arrows (BRD-1) back to the tab.
import type { PageSnapshot } from '../adapter/snapshot.ts';
import type { PositionEval } from '../classify/classify.ts';
import { Uci } from '../engine/uci.ts';
import { PRESETS, review, type Preset } from '../review/review.ts';
import type { PanelMessage } from '../content/content.ts';
import { boardArrows } from './arrows.ts';
import { elsewhere, Session, type Source, type View } from './session.ts';
import { ReviewStore } from './store.ts';
import { mount } from './view.ts';

const CHESS_COM = /^https:\/\/www\.chess\.com\//;
/** The engine build; part of the stored reviews' key (DATA-1). */
const ENGINE = 'stockfish-19-lite-single';

const worker = new Worker(chrome.runtime.getURL(`engine/${ENGINE}.js`));
const uci = new Uci((cmd) => worker.postMessage(cmd));
worker.onmessage = (e: MessageEvent<string>) => uci.receive(e.data);
const ready = uci.init({ Hash: 64, Threads: 1 });
/** Evaluations by FEN for each preset, kept while the panel is open. */
const caches: Record<Preset, Map<string, PositionEval>> = { fast: new Map(), normal: new Map(), deep: new Map() };
/** DATA-1: ENG-4's preset, FP-3's auto-review and BRD-4's arrows; SET-2 brings the rest. */
interface Settings {
  preset: Preset;
  autoReview: boolean;
  arrows: boolean;
}
const stored = (await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined;
const settings: Settings = { preset: 'normal', autoReview: true, arrows: true, ...stored };
/** A store that fails only costs the instant reopen. */
const store = ReviewStore.open(ENGINE).catch((e: unknown) => (console.error(e), null));

let render: (view: View) => void = () => {};
const session = new Session(
  async (game, opts) => {
    const depth = PRESETS[settings.preset];
    const cache = caches[settings.preset];
    const db = await store;
    const positions = await db?.get(game, depth).catch((e: unknown) => (console.error(e), undefined));
    // A stored game is graded again from its evaluations, without waiting for the engine.
    if (positions) return review(uci, game, { depth, cache: new Map(positions.map((p) => [p.fen, p])), ...opts });
    await ready;
    const r = await review(uci, game, { depth, cache, ...opts });
    db?.put(game, depth, r.positions).catch((e: unknown) => console.error(e));
    return r;
  },
  (view) => {
    render(view);
    sendArrows(view);
  },
);
render = mount({
  paste: (text) => session.paste(text),
  closePaste: () => session.closePaste(),
  review: () => session.review(),
  select: (move) => post(activePort(), { select: move }),
});
session.setAutoReview(settings.autoReview);

const preset = document.getElementById('preset') as HTMLSelectElement;
const autoReview = document.getElementById('auto-review') as HTMLInputElement;
const arrows = document.getElementById('arrows') as HTMLInputElement;
preset.value = settings.preset;
autoReview.checked = settings.autoReview;
arrows.checked = settings.arrows;
const save = () => chrome.storage.local.set({ settings }).catch((e: unknown) => console.error(e));
preset.addEventListener('change', () => {
  settings.preset = preset.value as Preset;
  void save();
  session.restart();
});
autoReview.addEventListener('change', () => {
  settings.autoReview = autoReview.checked;
  void save();
  session.setAutoReview(autoReview.checked);
});
arrows.addEventListener('change', () => {
  settings.arrows = arrows.checked;
  void save();
  sendArrows(session.view);
});

const { id: windowId } = await chrome.windows.getCurrent();

/** Every chess.com tab, in every window: the active one is reviewed, the others can lock the panel (FP-5). */
interface Watched {
  tab: chrome.tabs.Tab;
  port: chrome.runtime.Port | null;
  snapshot: PageSnapshot | null;
  unread: boolean;
}
const watched = new Map<number, Watched>();
let activeId: number | undefined;
let shown: Source | null = null;

function watch(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return;
  // The host permission shows chess.com URLs only; any other tab has none.
  if (!tab.url || !CHESS_COM.test(tab.url)) return drop(tab.id);
  const old = watched.get(tab.id);
  if (old?.port || (old && tab.discarded)) {
    old.tab = tab;
    return update();
  }
  const w: Watched = { tab, port: null, snapshot: null, unread: false };
  watched.set(tab.id, w);
  if (!tab.discarded) {
    const p = (w.port = chrome.tabs.connect(tab.id));
    let answered = false;
    p.onMessage.addListener((snapshot: PageSnapshot) => {
      answered = true;
      w.snapshot = snapshot;
      update();
    });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // "Receiving end does not exist" when the tab has no content script
      if (w.port !== p) return;
      w.port = null;
      w.snapshot = null;
      // A page that answered and then went away is navigating; its next content script says when it's ready.
      w.unread = !answered;
      update();
    });
  }
  update();
}

function drop(tabId: number): void {
  watched.get(tabId)?.port?.disconnect();
  if (watched.delete(tabId)) update();
}

function update(): void {
  const others = [...watched].filter(([id]) => id !== activeId);
  session.setElsewhere(
    elsewhere(others.map(([, w]) => ({ url: w.tab.url!, snapshot: w.snapshot, unread: w.unread, discarded: !!w.tab.discarded }))),
  );
  const w = activeId === undefined ? undefined : watched.get(activeId);
  const source: Source =
    !w ? { kind: 'other-site' }
    : w.snapshot ? { kind: 'page', snapshot: w.snapshot }
    : w.unread ? { kind: 'no-reader' }
    : { kind: 'connecting' };
  // Other tabs' messages mustn't replay the active tab's source (it would restart the mismatch grace).
  if (source.kind === 'page' ? shown?.kind === 'page' && shown.snapshot === source.snapshot : shown?.kind === source.kind) {
    return;
  }
  shown = source;
  session.setSource(source);
}

function activePort(): chrome.runtime.Port | null {
  return (activeId !== undefined && watched.get(activeId)?.port) || null;
}

/** A port can close between two messages (the page navigated); its content script is gone and needs nothing. */
function post(port: chrome.runtime.Port | null, message: PanelMessage): void {
  try {
    port?.postMessage(message);
  } catch {}
}

let arrowsPort: chrome.runtime.Port | null = null;
let arrowsSent = '[]';

/** Sends the active tab its arrows when they change, and clears them from a tab the panel leaves. */
function sendArrows(view: View): void {
  const port = activePort();
  if (port !== arrowsPort) {
    post(arrowsPort, { arrows: [] });
    arrowsPort = port;
    arrowsSent = '[]';
  }
  const next = settings.arrows ? boardArrows(view) : [];
  const json = JSON.stringify(next);
  if (!port || json === arrowsSent) return;
  arrowsSent = json;
  post(port, { arrows: next });
}

async function activate(tabId: number): Promise<void> {
  activeId = tabId;
  watch(await chrome.tabs.get(tabId));
  update();
}

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId) void activate(info.tabId);
});
// A reload or a new page replaces the content script and closes its port: reconnect as soon as the new content script
// says it is ready, or else once the page has loaded. Navigation inside chess.com keeps the content script and its port.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message === 'ponpon:ready' && sender.tab) watch(sender.tab);
});
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url || change.status === 'complete' || change.discarded !== undefined) watch(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => drop(tabId));

for (const tab of await chrome.tabs.query({ url: 'https://www.chess.com/*' })) watch(tab);
const [active] = await chrome.tabs.query({ active: true, windowId });
if (active?.id !== undefined) void activate(active.id);
document.addEventListener('visibilitychange', () => session.setVisible(document.visibilityState === 'visible'));
