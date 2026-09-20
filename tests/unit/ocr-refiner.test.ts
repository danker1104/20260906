import { describe, expect, it } from 'vitest';
import { refineOcrQueries } from '../../src/lib/search/query-refinement';

describe('OCR refiner fallback contract', () => {
  it('keeps raw OCR and provides a deterministic fallback when the model is unavailable', () => {
    const rawText = '『犬夜叉』30周年の記念本11月発売 原画集&インタビュー集で';
    const fallback = refineOcrQueries([rawText]);

    expect(fallback.rawText).toBe(rawText);
    expect(fallback.titleCandidates).toEqual(['犬夜叉']);
    expect(fallback.queryType).toBe('TITLE');
  });
});
