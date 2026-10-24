import { Chess } from 'chess.js';

/** FEN of every position P0…Pn reached by the SAN list (SRC-3). Throws on the first move that doesn't parse. */
export function replay(sans: string[], startFen?: string): string[] {
  const chess = new Chess(startFen);
  const fens = [chess.fen()];
  for (const san of sans) {
    chess.move(san);
    fens.push(chess.fen());
  }
  return fens;
}

export function sansFromPgn(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history();
}
