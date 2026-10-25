import { describe, expect, it } from 'vitest';
import { buildRefinedJapaneseQueries, refineOcrQueries, scoreOcrTitleCandidate } from '../../src/lib/search/query-refinement';
import { instagramOcrText } from '../fixtures/instagram-ocr';

describe('OCR query refinement', () => {
  it.each([
    ['放課後のアイドルには秘密がある', '放課後のアイドルには秘密がある'],
    ['異世界で\n小さな図書館を\n開いた私の\n静かな日々', '異世界で小さな図書館を開いた私の静かな日々'],
    ['「待って！」\n星空の\n図書館\nそんなこと\n言えない。', '星空の図書館'],
    ['팔로우\n@creator\n123\n#星空の図書館\n번역 보기', '星空の図書館'],
    ['creator New chapter! #星空の図書館 Follow me', '星空の図書館'],
    ['葬送\nの\nフリーレン', '葬送のフリーレン'],
  ])('preserves full title clues from %s', (rawText, expected) => {
    expect(refineOcrQueries([rawText]).titleCandidates).toContain(expected);
  });

  it('does not join distant regions or different images and bounds candidate count', () => {
    const refinement = refineOcrQueries(['星空の\n図書館'], [[
      { text: '星空の', top: 10, left: 10, width: 100, height: 20 },
      { text: '図書館', top: 400, left: 10, width: 100, height: 20 },
    ]]);
    expect(refinement.titleCandidates).not.toContain('星空の図書館');
    expect(refineOcrQueries(['星空の', '図書館']).titleCandidates).not.toContain('星空の図書館');
    expect(refineOcrQueries([Array(100).fill('星空の').join('\n')]).titleCandidates.length).toBeLessThanOrEqual(6);
    expect(refineOcrQueries(['팔로우\n123\nzararkun']).queryType).toBe('NONE');
  });

  it('reconstructs a multiline Instagram title while retaining the original OCR', () => {
    const refinement = refineOcrQueries([instagramOcrText]);

    expect(refinement.rawText).toBe(instagramOcrText);
    expect(refinement.titleCandidates[0]).toBe('放課後のアイドルには秘密がある');
    expect(buildRefinedJapaneseQueries(refinement)[0]).toBe('"放課後のアイドルには秘密がある" 漫画');
    expect(refinement.titleCandidates).not.toContain('彼女の秘密。');
  });

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

  it('rejects mixed-script OCR noise without discarding a short Japanese title', () => {
    expect(refineOcrQueries(['aB7x ふぁ']).queryType).toBe('NONE');
    expect(refineOcrQueries(['作品名']).titleCandidates).toContain('作品名');
    expect(refineOcrQueries(['作品名']).dialogueCandidates).toContain('作品名');
  });

  it('scores Japanese title-like clues above English captions and social UI', () => {
    const titleScore = scoreOcrTitleCandidate('放課後のアイドルには秘密がある').score;
    const captionScore = scoreOcrTitleCandidate('Follow @creator New chapter is so cute').score;
    const uiScore = scoreOcrTitleCandidate('いいね 128 コメント シェア 保存').score;

    expect(titleScore).toBeGreaterThan(captionScore);
    expect(titleScore).toBeGreaterThan(uiScore);
    expect(scoreOcrTitleCandidate('作品名').accepted).toBe(true);
  });
});
