// UCI client over any line transport: the side panel's Web Worker, or the stockfish npm module under Node.

export type Score = { cp: number } | { mate: number };

export interface Info {
  depth: number;
  multipv: number;
  /** From the side to move's point of view; ENG-3's normalisation to White happens in the review pipeline. */
  score: Score;
  /** Set when the score is only a bound (the search failed high or low). */
  bound?: 'lower' | 'upper';
  nodes: number;
  nps: number;
  /** Milliseconds since `go`. */
  time: number;
  /** UCI moves, e.g. `e2e4`. */
  pv: string[];
}

/** Parses an `info` line. Returns null for lines without a score (`info string`, `currmove`, …). */
export function parseInfo(line: string): Info | null {
  const t = line.split(' ');
  if (t[0] !== 'info') return null;
  let depth: number | undefined;
  let score: Score | undefined;
  const info: Omit<Info, 'depth' | 'score'> = { multipv: 1, nodes: 0, nps: 0, time: 0, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string':
        return null;
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        info.multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        score = kind === 'mate' ? { mate: v } : { cp: v };
        break;
      }
      case 'lowerbound':
        info.bound = 'lower';
        break;
      case 'upperbound':
        info.bound = 'upper';
        break;
      case 'nodes':
      case 'nps':
      case 'time':
        info[t[i] as 'nodes' | 'nps' | 'time'] = Number(t[++i]);
        break;
      case 'pv':
        info.pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  return depth === undefined || !score ? null : { depth, score, ...info };
}

/** One request at a time; feed every engine line to `receive`. */
export class Uci {
  readonly #send: (cmd: string) => void;
  #waiter: { until: (line: string) => boolean; onLine?: (line: string) => void; resolve: (line: string) => void } | null =
    null;

  constructor(send: (cmd: string) => void) {
    this.#send = send;
  }

  receive(line: string): void {
    const w = this.#waiter;
    if (!w) return;
    w.onLine?.(line);
    if (w.until(line)) {
      this.#waiter = null;
      w.resolve(line);
    }
  }

  /** Sends without waiting for an answer (`setoption`, `position`, `stop`). */
  send(cmd: string): void {
    this.#send(cmd);
  }

  /** Sends `cmd` and resolves with the first line that satisfies `until`. The waiter goes in first because the engine may answer synchronously. */
  request(cmd: string, until: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    if (this.#waiter) throw new Error(`UCI request pending, can't send ${cmd}`);
    const answered = new Promise<string>((resolve) => {
      this.#waiter = { until, onLine, resolve };
    });
    this.#send(cmd);
    return answered;
  }

  async init(options: Record<string, string | number>): Promise<void> {
    await this.request('uci', (l) => l === 'uciok');
    for (const [name, value] of Object.entries(options)) this.#send(`setoption name ${name} value ${value}`);
    await this.isReady();
  }

  isReady(): Promise<string> {
    return this.request('isready', (l) => l === 'readyok');
  }

  /** Runs `go <args>` and resolves with the `bestmove` line; `onInfo` gets every scored info line. */
  go(args: string, onInfo?: (info: Info) => void): Promise<string> {
    return this.request(
      `go ${args}`,
      (l) => l.startsWith('bestmove'),
      onInfo &&
        ((l) => {
          const info = parseInfo(l);
          if (info) onInfo(info);
        }),
    );
  }
}
