// The M0(b) engine benchmark under Node, as a baseline for the side panel's run in Chrome. Same WASM, same positions.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { runBench } from '../src/engine/bench.ts';
import { Uci } from '../src/engine/uci.ts';
import { replay, sansFromPgn } from '../src/game/replay.ts';

const fens = replay(sansFromPgn(readFileSync('test/fixtures/pgn/185404401434.pgn', 'utf8')));
const uci = new Uci((cmd) => engine.processCommand(cmd));
const engine = createRequire(import.meta.url)('stockfish')('lite-single', (line: string) => uci.receive(line));

const env = `Node ${process.version}, ${cpus()[0].model}`;
const report = await runBench(uci, fens, env, (msg) => process.stderr.write(`\r${msg.padEnd(30)}`));
process.stderr.write('\n');
console.log(report);
engine.terminate();
