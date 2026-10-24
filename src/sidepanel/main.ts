// M0(b) side panel: runs the engine benchmark in a Web Worker and shows the report to paste into docs/perf.md.
import pgn from '../../test/fixtures/pgn/185404401434.pgn?raw';
import { runBench } from '../engine/bench.ts';
import { Uci } from '../engine/uci.ts';
import { replay, sansFromPgn } from '../game/replay.ts';

const run = document.querySelector<HTMLButtonElement>('#run')!;
const copy = document.querySelector<HTMLButtonElement>('#copy')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const out = document.querySelector<HTMLPreElement>('#out')!;

run.addEventListener('click', async () => {
  run.disabled = copy.disabled = true;
  out.textContent = '';
  const worker = new Worker(chrome.runtime.getURL('engine/stockfish-19-lite-single.js'));
  const uci = new Uci((cmd) => worker.postMessage(cmd));
  worker.onmessage = (e: MessageEvent<string>) => uci.receive(e.data);
  worker.onerror = (e) => (status.textContent = `Worker error: ${e.message}`);
  try {
    const version = /Chrome\/(\S+)/.exec(navigator.userAgent)?.[1] ?? navigator.userAgent;
    const env = `Chrome ${version}, ${navigator.hardwareConcurrency} logical cores`;
    out.textContent = await runBench(uci, replay(sansFromPgn(pgn)), env, (msg) => (status.textContent = msg));
    copy.disabled = false;
  } catch (e) {
    status.textContent = String(e);
  } finally {
    worker.terminate();
    run.disabled = false;
  }
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(out.textContent ?? '');
  status.textContent = 'Copied';
});
