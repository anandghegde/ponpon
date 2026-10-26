// The side panel: follows the content script in this window's active tab, reviews and suggests in a Stockfish Web
// Worker (ENG-2), renders the Session, and sends the board's arrows (BRD-1) back to the tab.
import type { PageSnapshot } from '../adapter/snapshot.ts';
import type { PositionEval } from '../classify/classify.ts';
import { Uci } from '../engine/uci.ts';
import { PRESETS, review, type Preset } from '../review/review.ts';
import { suggest } from '../suggest/suggest.ts';
import type { PanelMessage } from '../content/content.ts';
import { boardMarks } from './arrows.ts';
import { Session, type Source, type View } from './session.ts';
import { ReviewStore } from './store.ts';
import { mount, type LabelSet } from './view.ts';

const CHESS_COM = /^https:\/\/www\.chess\.com\//;
/** The engine build; part of the stored reviews' key (DATA-1). */
const ENGINE = 'stockfish-19-lite-single';

const worker = new Worker(chrome.runtime.getURL(`engine/${ENGINE}.js`));
const uci = new Uci((cmd) => worker.postMessage(cmd));
worker.onmessage = (e: MessageEvent<string>) => uci.receive(e.data);
const ready = uci.init({ Hash: 64, Threads: 1 });
/** Evaluations by FEN for each preset, kept while the panel is open. */
const caches: Record<Preset, Map<string, PositionEval>> = { fast: new Map(), normal: new Map(), deep: new Map() };
/** DATA-1 and SET-2: SET-1's labels, ENG-4's preset, SUG-1's lines, FP-3's auto-review and BRD-4's arrows and badges. */
interface Settings {
  labels: LabelSet;
  preset: Preset;
  lines: number;
  autoReview: boolean;
  arrows: boolean;
  badges: boolean;
}
const { settings: stored, introSeen } = await chrome.storage.local.get(['settings', 'introSeen']);
const settings: Settings = {
  labels: 'english',
  preset: 'normal',
  lines: 3,
  autoReview: true,
  arrows: true,
  badges: true,
  ...(stored as Partial<Settings> | undefined),
};
// SET-4: the first-run screen, until "Got it"; About shows it again.
const showIntro = (on: boolean) => {
  document.getElementById('intro')!.hidden = !on;
  document.body.classList.toggle('intro', on);
};
showIntro(!introSeen);
/** A store that fails only costs the instant reopen. */
const store = ReviewStore.open(ENGINE).catch((e: unknown) => (console.error(e), null));
const settingsBox = document.getElementById('settings') as HTMLDetailsElement;
const cacheSize = document.getElementById('cache-size')!;

/** SET-3, while Settings is open. */
async function showCacheSize(): Promise<void> {
  if (!settingsBox.open) return;
  const size = await (await store)?.size().catch((e: unknown) => (console.error(e), undefined));
  cacheSize.textContent = !size
    ? 'unavailable'
    : `${size.games} ${size.games === 1 ? 'game' : 'games'}, ` +
      (size.bytes < 1e6 ? `${Math.ceil(size.bytes / 1e3)} kB` : `${(size.bytes / 1e6).toFixed(1)} MB`);
}

let render: (view: View) => void = () => {};
const session = new Session(
  async (game, opts) => {
    const depth = PRESETS[settings.preset];
    const cache = caches[settings.preset];
    const db = await store;
    const positions = await db?.get(game, depth).catch((e: unknown) => (console.error(e), undefined));
    // A stored game is graded again from its evaluations, without waiting for the engine. Reviews stored before
    // M2 have no depth on their positions; the store's key has it.
    if (positions) return review(uci, game, { depth, cache: new Map(positions.map((p) => [p.fen, { ...p, depth }])), ...opts });
    await ready;
    const r = await review(uci, game, { depth, cache, ...opts });
    db?.put(game, depth, r.positions).then(showCacheSize, (e: unknown) => console.error(e));
    return r;
  },
  async (game, ply, opts) => {
    await ready;
    return suggest(uci, game, ply, opts);
  },
  (view) => {
    render(view);
    sendMarks(view);
  },
);
render = mount({
  paste: (text) => session.paste(text),
  closePaste: () => session.closePaste(),
  review: () => session.review(),
  select: (move) => post(activePort(), { select: move }),
  pick: (position) => session.pick(position),
}, settings);
session.setAutoReview(settings.autoReview);
session.setLines(settings.lines);

const labelSet = document.getElementById('label-set') as HTMLSelectElement;
const preset = document.getElementById('preset') as HTMLSelectElement;
const lines = document.getElementById('lines') as HTMLSelectElement;
const autoReview = document.getElementById('auto-review') as HTMLInputElement;
const arrows = document.getElementById('arrows') as HTMLInputElement;
const badges = document.getElementById('badges') as HTMLInputElement;
labelSet.value = settings.labels;
preset.value = settings.preset;
lines.value = String(settings.lines);
autoReview.checked = settings.autoReview;
arrows.checked = settings.arrows;
badges.checked = settings.badges;
const save = () => chrome.storage.local.set({ settings }).catch((e: unknown) => console.error(e));
labelSet.addEventListener('change', () => {
  settings.labels = labelSet.value as LabelSet;
  void save();
  render(session.view);
});
preset.addEventListener('change', () => {
  settings.preset = preset.value as Preset;
  void save();
  session.restart();
});
lines.addEventListener('change', () => {
  settings.lines = Number(lines.value);
  void save();
  session.setLines(settings.lines);
});
autoReview.addEventListener('change', () => {
  settings.autoReview = autoReview.checked;
  void save();
  session.setAutoReview(autoReview.checked);
});
for (const box of [arrows, badges]) {
  box.addEventListener('change', () => {
    settings[box.id as 'arrows' | 'badges'] = box.checked;
    void save();
    sendMarks(session.view);
  });
}
// BRD-4's shortcut, set in the manifest; the user can change it at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-arrows') return;
  arrows.checked = !arrows.checked;
  arrows.dispatchEvent(new Event('change'));
});
const shortcut = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-arrows')?.shortcut;
document.getElementById('shortcut')!.textContent = shortcut ? `(${shortcut})` : '';
settingsBox.addEventListener('toggle', () => void showCacheSize());
document.getElementById('clear-cache')!.addEventListener('click', async () => {
  for (const cache of Object.values(caches)) cache.clear();
  await (await store)?.clear().catch((e: unknown) => console.error(e));
  void showCacheSize();
});
document.getElementById('intro-done')!.addEventListener('click', () => {
  showIntro(false);
  chrome.storage.local.set({ introSeen: true }).catch((e: unknown) => console.error(e));
});
document.getElementById('intro-again')!.addEventListener('click', () => showIntro(true));
document.getElementById('version')!.textContent = chrome.runtime.getManifest().version;

const { id: windowId } = await chrome.windows.getCurrent();

/** Every chess.com tab, in every window: its snapshot keeps the panel current when the active tab changes, and its port carries the board's marks. */
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

const NO_MARKS = { arrows: [], badge: null };
let marksPort: chrome.runtime.Port | null = null;
let marksSent = JSON.stringify(NO_MARKS);

/** Sends the active tab its arrows and badge when they change, and clears them from a tab the panel leaves. */
function sendMarks(view: View): void {
  const port = activePort();
  if (port !== marksPort) {
    post(marksPort, { marks: NO_MARKS });
    marksPort = port;
    marksSent = JSON.stringify(NO_MARKS);
  }
  const marks = boardMarks(view, settings);
  const json = JSON.stringify(marks);
  if (!port || json === marksSent) return;
  marksSent = json;
  post(port, { marks });
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
