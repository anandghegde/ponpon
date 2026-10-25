// CLS-5: every golden position gets its hand-checked label, graded from the recorded engine output.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PositionEval } from '../src/classify/classify.ts';
import { Uci } from '../src/engine/uci.ts';
import { PRESETS, review } from '../src/review/review.ts';
import { GOLDEN, GOLDEN_EVALS } from './golden-cases.ts';

const recorded: PositionEval[] = JSON.parse(readFileSync(GOLDEN_EVALS, 'utf8'));
const offline = new Uci(() => {
  throw new Error('A position is missing from the recording: run npm run record:golden');
});

describe('golden positions (CLS-5)', () => {
  it('has the cases the PRD asks for', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(30);
    const labels = new Set(GOLDEN.map((c) => c.label));
    for (const l of ['book', 'brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']) {
      expect(labels).toContain(l);
    }
  });

  it.each(GOLDEN)('$name: $label', async (c) => {
    const cache = new Map(recorded.map((p) => [p.fen, p]));
    const r = await review(offline, { sans: c.moves, startFen: c.fen }, { depth: PRESETS.normal, cache });
    expect(r.moves.at(-1)!.label).toBe(c.label);
  });
});
