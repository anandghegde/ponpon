// The live FP matrix (FP-6, PRD §10): the built extension on real chess.com pages, in Chrome for Testing.
//   npm run build && npm run e2e
// Chrome only opens a real side panel from a user gesture, so the panel page runs in its own window, patched to
// follow the other window's active tab. Logged out, chess.com hides games in progress, so a game in progress is
// simulated: a finished game's result row is hidden as it renders, then put back, and a planted profile link says
// who "I" am. Uses the network; takes about 5 minutes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const DIST = resolve('dist');
/** An unpacked extension's id comes from its path. */
const ID = [...createHash('sha256').update(DIST).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');
const PANEL = `chrome-extension://${ID}/src/sidepanel/index.html`;
const GAME = 'https://www.chess.com/game/live/';
const PGN = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0';
const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

interface PanelState {
  status: string;
  notice: string | null;
  held: boolean;
  summary: string | null;
  detail: string | null;
  moves: number;
  graded: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const shots = mkdtempSync(join(tmpdir(), 'ponpon-e2e-shots-'));
const requests: string[] = [];

const browser = await puppeteer.launch({
  executablePath: process.env.PONPON_CHROME ?? chromeForTesting(),
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'ponpon-e2e-')),
  defaultViewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--load-extension=${DIST}`, `--disable-extensions-except=${DIST}`, '--window-size=1300,900'],
});
const [tab] = await browser.pages();
let panel = await openPanel();

try {
  await go(`${GAME}185851072404`);
  const start = await until((s) => s.status.startsWith('Reviewing'), 30000, 50);
  // Mostly chess.com's own load time: the content script runs once the page is idle.
  check('The panel picks up a page as it loads', start.ms <= 10000, `${start.ms} ms after the page's DOM`);
  const first = await until((s) => s.graded > 0, 20000, 50);
  check('First label within 5 s of the review starting (§9)', first.ms <= 5000, `${first.ms} ms`);
  const done = await until((s) => s.summary !== null, 180000);
  check('Finished game reviewed at Normal', !done.timedOut, `${done.moves} moves in ${(done.ms / 1000).toFixed(1)} s`);

  // Arrows on the board (BRD-1, BRD-2), and the panel and the board following each other (SYNC-1, SYNC-2).
  await panel.$eval('#moves [data-ply="12"]', (e) => (e as HTMLElement).click());
  const synced = await until((s) => !!s.detail?.startsWith('7. f4'), 5000, 50);
  await sleep(500);
  const drawn = await arrowsOnPage();
  check(
    'A move clicked in the panel shows on the board, with its arrows (SYNC-2, BRD-1)',
    !synced.timedOut && drawn.kinds.join() === 'better,best,second' && drawn.onBoard,
    drawn.kinds.join(', '),
  );
  check('…and a ?? badge on the corner of f4, where the blunder went (BRD-3)', drawn.badge === '??' && drawn.badgeSquare === 'f4', `${drawn.badge} on ${drawn.badgeSquare}`);
  await tab.screenshot({ path: join(shots, 'arrows.png') });
  await tab.focus('body');
  await tab.keyboard.press('ArrowLeft');
  const stepped = await until((s) => !!s.detail?.startsWith('6…'), 5000, 50);
  await sleep(500);
  check('Stepping back on chess.com moves the card and the arrows (SYNC-1)', !stepped.timedOut && (await arrowsOnPage()).kinds.length > 0, stepped.detail ?? '');
  await setMarks('arrows', false);
  await sleep(500);
  const noArrows = await arrowsOnPage();
  check('Arrows turn off, the badge stays (BRD-4)', noArrows.kinds.length === 0 && noArrows.badge === '?', `badge ${noArrows.badge} for 6… g6`);
  await setMarks('badges', false);
  await sleep(500);
  check('Badges turn off (BRD-4)', (await arrowsOnPage()).badge === null, '');
  await setMarks('arrows', true);
  await setMarks('badges', true);

  panel = await openPanel();
  const again = await until((s) => s.summary !== null, 5000);
  check('A reviewed game opens again instantly (DATA-2)', again.ms < 1000, `${again.ms} ms`);

  await setPreset('fast');
  check('Fast preset reviews again', !(await until((s) => s.summary !== null, 60000)).timedOut, '');
  panel = await openPanel();
  check('The preset survives the panel', (await panel.$eval('#preset', (e) => (e as HTMLSelectElement).value)) === 'fast', '');
  await setPreset('normal');
  const back = await until((s) => s.summary !== null, 5000);
  check('Normal reopens from the store', back.ms < 1000, `${back.ms} ms`);

  await go('https://www.chess.com/');
  const home = await until((s) => !!s.notice?.startsWith('PonPon stays off'), 30000);
  check('chess.com home is locked (unknown)', !home.timedOut && home.moves === 0, home.notice ?? '');
  await go('https://www.chess.com/puzzles/rated');
  const puzzles = await until((s) => !!s.notice?.includes("doesn't work"), 30000);
  check('Puzzles are unsupported', !puzzles.timedOut, puzzles.notice ?? '');

  await go('https://example.com/');
  check('Another site invites a paste', !(await until((s) => !!s.notice?.startsWith('Open a game'), 20000)).timedOut, '');
  check('Pasted PGN is reviewed', (await paste(PGN)) === '' && !(await until((s) => s.summary !== null, 30000)).timedOut, '');
  await panel.$eval('#close-paste', (e) => (e as HTMLElement).click());
  check('Pasted FEN shows the position', (await paste(FEN)) === '' && !(await until((s) => s.detail !== null, 30000)).timedOut, '');
  check('Bad paste is refused', (await paste('not a game')) !== '', '');

  // A game ends while I watch (FP-2, FP-3). Logged out, a game in progress counts as possibly mine.
  const hider = await hideResult(tab);
  await go(`${GAME}185689081726`);
  const live = await until((s) => !!s.notice?.startsWith('Game in progress'), 30000);
  await sleep(3500);
  const quiet = await state();
  check(
    'In progress: nothing shown, no arrows, engine idle (FP-1)',
    !live.timedOut && quiet.moves === 0 && quiet.status === '' && (await arrowsOnPage()).kinds.length === 0,
    quiet.notice ?? '',
  );
  await endGame(tab);
  const auto = await until((s) => s.status.startsWith('Reviewing'), 5000, 20);
  check('Result appears: the review starts (FP-3, SRC-5)', !auto.timedOut, `${auto.ms} ms`);

  await setAutoReview(false);
  await go(`${GAME}185404401434`);
  await until((s) => !!s.notice?.startsWith('Game in progress'), 30000);
  await sleep(3500);
  await endGame(tab);
  const held = await until((s) => s.held, 5000, 20);
  await sleep(2000);
  check('Auto-review off: the ended game waits', !held.timedOut && (await state()).graded === 0, '');
  await panel.click('#review-now');
  check('…until Review it', !(await until((s) => s.status.startsWith('Reviewing'), 5000, 20)).timedOut, '');
  await tab.removeScriptToEvaluateOnNewDocument(hider.identifier);
  await go(`${GAME}185251405966`);
  const archive = await until((s) => s.status.startsWith('Reviewing') || s.held, 30000, 50);
  check('Auto-review off: a finished game still reviews at once', !archive.held && !archive.timedOut, '');
  await setAutoReview(true);

  // Someone else's game (FP-7): a profile link is planted, first for a third person, then for one of the players.
  let planted = [await hideResult(tab), await plant(tab, 'someone-watching')];
  await go(`${GAME}185859709598`);
  const watching = await until((s) => s.status.startsWith('Reviewing') || s.summary !== null, 30000, 50);
  const inProgress = await tab.evaluate(() => !document.querySelector('.game-result'));
  check("Someone else's game in progress is reviewed live (FP-7)", !watching.timedOut && inProgress, '');
  const t0 = Date.now();
  while (!(await arrowsOnPage()).kinds.includes('best') && Date.now() - t0 < 10000) await sleep(100);
  check('…with arrows on the live position within seconds', Date.now() - t0 < 10000, `${Date.now() - t0} ms`);
  // The page itself turns into a game of mine: the content script clears its arrows without waiting for the panel.
  await tab.evaluate(() => {
    document.querySelector('#board-layout-player-top .cc-user-username-component')!.textContent = 'someone-watching';
  });
  await sleep(400);
  check('A page that becomes my game clears its own arrows (PRD §8)', (await arrowsOnPage()).kinds.length === 0, '');
  await endGame(tab);
  const over = await until((s) => s.summary !== null, 120000);
  check('…and nothing waits when it ends', !over.timedOut && !over.held, '');
  for (const script of planted) await tab.removeScriptToEvaluateOnNewDocument(script.identifier);
  planted = [await hideResult(tab), await plant(tab, 'bowod28216')];
  await go(`${GAME}185859709598`);
  const mine = await until((s) => !!s.notice?.startsWith('Game in progress'), 30000);
  check('My own game in progress stays locked (FP-7)', !mine.timedOut && mine.moves === 0, mine.notice ?? '');
  for (const script of planted) await tab.removeScriptToEvaluateOnNewDocument(script.identifier);

  // Analysis board and a bot game (FP-4).
  await go('https://www.chess.com/analysis');
  check('Empty analysis board shows the position', !(await until((s) => s.detail !== null, 30000)).timedOut, '');
  await wakeBoard();
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) await move(from, to, 1);
  const analysis = await until((s) => s.moves === 4 && s.graded === 4, 30000);
  check('Analysis moves are graded as they are played', !analysis.timedOut, `${analysis.moves} moves`);

  // FP-5: a game of mine in progress in another window locks this one until it's closed.
  const other = await browser.newPage({ type: 'window', windowBounds: { width: 900, height: 700 } });
  await hideResult(other);
  await plant(other, 'bowod28216');
  await other.goto(`${GAME}185859709598`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const locked = await until((s) => !!s.notice?.startsWith('Another chess.com tab'), 30000, 50);
  check('A game of mine in another window locks the analysis board (FP-5)', !locked.timedOut && locked.moves === 0, '');
  await other.close();
  check('…until it closes', !(await until((s) => s.graded === 4, 10000, 50)).timedOut, '');

  await go('https://www.chess.com/play/computer');
  await sleep(5000);
  for (const label of ['Start', 'Play']) {
    await tab.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent!.trim() === t && b.offsetParent)?.click(), label);
    await sleep(2500);
  }
  await wakeBoard();
  for (const [from, to] of [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4']]) await move(from, to, 2);
  const plies = await tab.evaluate(() => document.querySelectorAll('.main-line-ply').length);
  const bot = await until((s) => s.moves === plies && s.graded === plies, 30000);
  check('Bot game graded live (FP-4)', plies >= 5 && !bot.timedOut, `${plies} plies`);

  // ENG-5: another tab, then a hidden panel.
  await go(`${GAME}185421044934`);
  await until((s) => s.graded >= 5, 60000);
  await panel.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
    await chrome.tabs.create({ windowId: t.windowId, url: 'https://example.com/' });
  });
  const away = await until((s) => s.notice !== null, 10000, 50);
  await sleep(2000);
  check('Another tab stops the review (ENG-5)', !away.timedOut && (await state()).moves === 0, '');
  await tab.bringToFront();
  const g = (await until((s) => s.graded > 0, 10000, 50)).graded;
  check('…and it resumes from the cache', g >= 5, `${g} moves graded at once`);
  const cdp = await panel.createCDPSession();
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  const paused = await until((s) => s.status === 'Paused', 5000, 50);
  await sleep(2000);
  check('A hidden panel pauses (ENG-5)', !paused.timedOut && (await state()).graded === paused.graded, '');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  check('…and resumes', !(await until((s) => s.summary !== null, 120000)).timedOut, '');

  const off = requests.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith('data:'));
  check('The panel makes no network requests (DATA-3)', off.length === 0, off.slice(0, 3).join(' '));
} catch (e) {
  check('The run finished', false, String(e));
} finally {
  await browser.close();
}

for (const [i, r] of results.entries()) {
  console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.detail ? `: ${r.detail}` : ''}${r.ok ? '' : ` (${join(shots, `${i + 1}.png`)})`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  // What the page looked like when a check failed.
  if (!ok) void tab.screenshot({ path: join(shots, `${results.length}.png`) }).catch(() => {});
}

function chromeForTesting(): string {
  const dir = join(homedir(), '.cache/puppeteer/chrome');
  const [newest] = readdirSync(dir).sort().reverse();
  return join(dir, newest, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}

/** Hides a game's result row as it renders, so a finished game reads as in progress until endGame(). */
function hideResult(page: Page) {
  return page.evaluateOnNewDocument(() => {
    const w = window as unknown as { hide: boolean; hidden: { node: Element; parent: Element }[] };
    w.hide = true;
    w.hidden = [];
    new MutationObserver(() => {
      if (!w.hide) return;
      for (const r of document.querySelectorAll('.game-result')) {
        w.hidden.push({ node: r, parent: r.parentElement! });
        r.remove();
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

function endGame(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { hide: boolean; hidden: { node: Element; parent: Element }[] };
    w.hide = false;
    for (const { node, parent } of w.hidden) parent.append(node);
  });
}

/** The run is logged out: this plants the sidebar's link to "my" profile, which is who chess.com says I am. */
function plant(page: Page, me: string) {
  return page.evaluateOnNewDocument((name: string) => {
    document.addEventListener('DOMContentLoaded', () => {
      const a = document.createElement('a');
      a.dataset.userActivityKey = 'profile';
      a.href = `https://www.chess.com/member/${name}`;
      document.body.append(a);
    });
  }, me);
}

async function openPanel(): Promise<Page> {
  for (const p of await browser.pages()) if (p.url() === PANEL) await p.close();
  const p = await browser.newPage({ type: 'window', windowBounds: { width: 420, height: 900 } });
  const cdp = await p.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => requests.push(e.request.url));
  await p.evaluateOnNewDocument(() => {
    const own = chrome.windows.getCurrent.bind(chrome.windows);
    chrome.windows.getCurrent = (async () => {
      const mine = await own();
      return (await chrome.windows.getAll()).find((w) => w.id !== mine.id) ?? mine;
    }) as typeof chrome.windows.getCurrent;
  });
  p.on('pageerror', (e) => check('No errors in the panel', false, String(e)));
  await p.goto(PANEL);
  await tab.bringToFront();
  return p;
}

async function go(url: string): Promise<void> {
  await tab.bringToFront();
  await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
}

function state(): Promise<PanelState> {
  return panel.evaluate(() => {
    const $ = (id: string) => document.getElementById(id)!;
    const text = (id: string) => ($(id).hidden ? null : $(id).innerText.replace(/\s+/g, ' '));
    const moves = [...document.querySelectorAll('#moves .move')];
    return {
      status: $('status').textContent!,
      notice: text('notice'),
      held: !$('held').hidden,
      summary: text('summary'),
      detail: text('detail'),
      moves: moves.length,
      graded: moves.filter((m) => !m.classList.contains('pending')).length,
    };
  });
}

async function until(pred: (s: PanelState) => boolean, timeout: number, every = 200) {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    const ms = Date.now() - t0;
    if (pred(s)) return { ...s, ms, timedOut: false };
    if (ms > timeout) return { ...s, ms, timedOut: true };
    await sleep(every);
  }
}

async function paste(text: string): Promise<string> {
  await panel.$eval('#pgn', (e, t) => ((e as HTMLTextAreaElement).value = t), text);
  await panel.$eval('#review-pgn', (e) => (e as HTMLElement).click());
  return panel.$eval('#paste-error', (e) => e.textContent ?? '');
}

async function setPreset(preset: string): Promise<void> {
  await panel.$eval('#settings', (e) => ((e as HTMLDetailsElement).open = true));
  await panel.select('#preset', preset);
}

async function setMarks(id: 'arrows' | 'badges', on: boolean): Promise<void> {
  await panel.$eval('#settings', (e) => ((e as HTMLDetailsElement).open = true));
  if ((await panel.$eval(`#${id}`, (e) => (e as HTMLInputElement).checked)) !== on) await panel.click(`#${id}`);
}

/**
 * What PonPon drew on chess.com's board: the arrows, whether their layer sits exactly on the board, and the badge with
 * the square whose top-right corner it's on (White at the bottom).
 */
function arrowsOnPage(): Promise<{ kinds: string[]; onBoard: boolean; badge: string | null; badgeSquare: string | null }> {
  return tab.evaluate(() => {
    const host = document.querySelector('ponpon-arrows');
    const kinds = [...(host?.shadowRoot?.querySelectorAll('polygon') ?? [])].map((p) => (p as SVGElement).dataset.kind!);
    const b = document.querySelector('wc-chess-board')!.getBoundingClientRect();
    const h = host?.getBoundingClientRect();
    const near = (x: number, y: number) => Math.abs(x - y) < 2;
    const g = host?.shadowRoot?.querySelector<SVGGElement>('g[data-badge]');
    let badgeSquare: string | null = null;
    if (g) {
      const r = g.getBoundingClientRect();
      const size = b.width / 8;
      // The badge's centre sits 0.38 of a square right of and above the square's centre.
      const file = Math.floor((r.left + r.width / 2 - b.left) / size - 0.38);
      const row = Math.floor((r.top + r.height / 2 - b.top) / size + 0.38);
      badgeSquare = `${'abcdefgh'[file]}${8 - row}`;
    }
    return {
      kinds,
      onBoard: !!h && near(h.left, b.left) && near(h.top, b.top) && near(h.width, b.width),
      badge: g?.dataset.badge ?? null,
      badgeSquare,
    };
  });
}

async function setAutoReview(on: boolean): Promise<void> {
  await panel.$eval('#settings', (e) => ((e as HTMLDetailsElement).open = true));
  if ((await panel.$eval('#auto-review', (e) => (e as HTMLInputElement).checked)) !== on) await panel.click('#auto-review');
}

/** The centre of a square on chess.com's board, in page pixels. */
async function square(sq: string): Promise<[number, number]> {
  const box = await tab.evaluate(() => {
    const board = document.querySelector('wc-chess-board')!;
    const r = board.getBoundingClientRect();
    return { x: r.x, y: r.y, size: r.width / 8, flipped: board.classList.contains('flipped') };
  });
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return box.flipped
    ? [box.x + (7.5 - f) * box.size, box.y + (r + 0.5) * box.size]
    : [box.x + (f + 0.5) * box.size, box.y + (7.5 - r) * box.size];
}

/** chess.com's board swallows its first click; spend it on an empty square. */
async function wakeBoard(): Promise<void> {
  await tab.mouse.click(...(await square('a5')));
  await sleep(1000);
}

/** Clicks a move on chess.com's board; `replies` is how many plies to wait for (2 when a bot answers). */
async function move(from: string, to: string, replies: number): Promise<void> {
  const count = () => tab.evaluate(() => document.querySelectorAll('.main-line-ply').length);
  const before = await count();
  // A board that is still starting up drops clicks: try again.
  for (let attempt = 0; attempt < 3 && (await count()) === before; attempt++) {
    await tab.mouse.click(...(await square(from)));
    await sleep(250);
    await tab.mouse.click(...(await square(to)));
    for (let i = 0; i < 12 && (await count()) === before; i++) await sleep(250);
  }
  for (let i = 0; i < 40 && (await count()) < before + replies; i++) await sleep(250);
  await sleep(600); // the board animates the move
}
