// Finished reviews in IndexedDB (DATA-1, DATA-2), so a reviewed game opens again without the engine. Only the
// evaluations are kept: the labels are graded again on open, so they follow the current classifier.
import type { PositionEval } from '../classify/classify.ts';
import type { Game } from '../review/review.ts';

/** DATA-2: games kept, least recently used evicted first. */
export const STORE_LIMIT = 500;

interface Entry {
  /** [engine, depth, start FEN or '', SANs joined by spaces]: the moves stand in for a game id or PGN hash. */
  key: [string, number, string, string];
  /** When the game was last stored or opened. */
  used: number;
  positions: PositionEval[];
}

export class ReviewStore {
  readonly #db: IDBDatabase;
  readonly #engine: string;

  static open(engine: string, factory: IDBFactory = indexedDB): Promise<ReviewStore> {
    return new Promise((resolve, reject) => {
      const r = factory.open('ponpon', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('reviews', { keyPath: 'key' }).createIndex('used', 'used');
      r.onsuccess = () => resolve(new ReviewStore(r.result, engine));
      r.onerror = () => reject(r.error);
    });
  }

  constructor(db: IDBDatabase, engine: string) {
    this.#db = db;
    this.#engine = engine;
  }

  /** The positions of a stored review, which then counts as just used. */
  async get(game: Game, depth: number): Promise<PositionEval[] | undefined> {
    const tx = this.#db.transaction('reviews', 'readwrite');
    const reviews = tx.objectStore('reviews');
    const r: IDBRequest<Entry | undefined> = reviews.get(this.#key(game, depth));
    r.onsuccess = () => {
      if (r.result) reviews.put({ ...r.result, used: Date.now() });
    };
    await done(tx);
    return r.result?.positions;
  }

  /** Replaces the game's shorter versions, so a bot game or an analysis line takes one place, not one per move. */
  async put(game: Game, depth: number, positions: PositionEval[]): Promise<void> {
    const tx = this.#db.transaction('reviews', 'readwrite');
    const reviews = tx.objectStore('reviews');
    for (let n = 0; n < game.sans.length; n++) reviews.delete(this.#key({ ...game, sans: game.sans.slice(0, n) }, depth));
    reviews.put({ key: this.#key(game, depth), used: Date.now(), positions } satisfies Entry);
    const count = reviews.count();
    count.onsuccess = () => {
      let excess = count.result - STORE_LIMIT;
      if (excess <= 0) return;
      const oldest = reviews.index('used').openCursor();
      oldest.onsuccess = () => {
        const cursor = oldest.result;
        if (!cursor || excess-- <= 0) return;
        cursor.delete();
        cursor.continue();
      };
    };
    await done(tx);
  }

  #key(game: Game, depth: number): Entry['key'] {
    return [this.#engine, depth, game.startFen ?? '', game.sans.join(' ')];
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
