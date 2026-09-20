import { describe, expect, it } from 'vitest';
import { buildRefinedJapaneseQueries, refineOcrQueries } from '../../src/lib/search/query-refinement';

describe('OCR query refinement', () => {
  it('extracts a bracketed title and removes promotional context from the query', () => {
    const refinement = refineOcrQueries(['『犬夜叉』30周年の記念本11月発売 原画集&インタビュー集で']);

    expect(refinement.titleCandidates).toEqual(['犬夜叉']);
    expect(refinement.queryType).toBe('TITLE');
    expect(buildRefinedJapaneseQueries(refinement)).toEqual(['"犬夜叉" 漫画']);
    expect(refinement.rawText).toContain('30周年');
    expect(refinement.noise).toEqual(expect.arrayContaining(['30周年', '11月', '発売', '原画集', 'インタビュー集']));
  });

  it('uses short dialogue clues when no title candidate is present', () => {
    const refinement = refineOcrQueries(['そんなこと\n俺が知るか']);

    expect(refinement.titleCandidates).toHaveLength(0);
    expect(refinement.dialogueCandidates).toContain('そんなこと');
    expect(refinement.queryType).toBe('DIALOGUE');
  });
});
