// Copies the Stockfish 19 lite single-threaded build (ENG-1) into public/engine so Vite ships it unchanged.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];
mkdirSync('public/engine', { recursive: true });
for (const f of files) copyFileSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`);
