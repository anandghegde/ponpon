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

/** An engine line (UCI moves) played from `fen`, in SAN. */
export function sanLine(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  return uciMoves.map((m) => chess.move(m).san);
}

/** A pasted PGN (SRC-4): its moves, its start position if it has a FEN header, and its headers. Throws when it doesn't parse. */
export function parsePgn(pgn: string): { sans: string[]; startFen?: string; headers: Record<string, string> } {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  return { sans: chess.history(), startFen: headers.FEN, headers };
}

export function sansFromPgn(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history();
}

/** The first four FEN fields (placement, side to move, castling, en passant): the key for book lookups (CLS-4). */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
