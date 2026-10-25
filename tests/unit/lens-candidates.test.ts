import { describe, expect, it } from 'vitest';
import type { LensMatch } from '../../src/lib/search/types';
import { rankLensCandidates, selectLensQueries } from '../../src/lib/search/lens-candidates';

const lensResults: LensMatch[] = [
  { title: 'AI chat companion for comic fans', source: 'Generic Assistant', link: 'https://assistant.example/app', position: 1 },
  { title: 'Anime image collection', source: 'Pinterest', link: 'https://pinterest.example/collection', position: 2 },
  { title: 'Comic service overview', source: 'Comic App', link: 'https://service.example/comic', position: 3 },
  { title: 'Manga recommendations', source: 'Example Blog', link: 'https://blog.example/recommendations', position: 4 },
  { title: 'Illustration gallery', source: 'Gallery', link: 'https://gallery.example/works', position: 5 },
  { title: 'Related merchandise', source: 'Shop', link: 'https://shop.example/item', position: 6 },
  { title: 'Comic news', source: 'News', link: 'https://news.example/comic', position: 7 },
  {
    title: 'Xの投稿',
    source: 'X',
    link: 'https://x.example/status/8',
    position: 8,
    snippet: '新作漫画 #灰宮先輩は怖くてかわいい',
  },
  {
    title: '灰宮先輩は怖くてかわいい！公式連載ページ',
    source: '連載サイト',
    link: 'https://serial.example/work',
    position: 9,
  },
  {
    title: '#灰宮先輩は怖くてかわいい',
    source: 'X',
    link: 'https://x.example/status/9',
    position: 10,
  },
  {
    title: '#灰宮先輩が怖くてかわいい',
    source: 'X',
    link: 'https://x.example/status/10',
    position: 11,
  },
];

describe('Lens candidate extraction', () => {
  it('keeps a three-character Japanese title when a generic manga suffix is present', () => {
    const candidates = rankLensCandidates([{
      title: '作品名 漫画',
      source: 'Example',
      link: 'https://example.com/lens',
    }]);

    expect(candidates[0]?.candidateTitle).toBe('作品名');
  });

  it('extracts a Japanese hashtag from later visual matches and ranks it above generic service results', () => {
    const candidates = rankLensCandidates(lensResults);

    expect(candidates[0]?.candidateTitle).toBe('灰宮先輩は怖くてかわいい');
    expect(candidates.some((candidate) => candidate.candidateTitle === 'の投稿')).toBe(false);
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateTitle: '灰宮先輩は怖くてかわいい',
        sourceUrl: 'https://x.example/status/8',
        lensPosition: 8,
        evidenceType: 'HASHTAG',
      }),
    ]));
    expect(candidates[0]).toMatchObject({
      rawTitle: 'Xの投稿',
      normalizedTitle: '灰宮先輩は怖くてかわいい',
      source: 'x.example',
      url: 'https://x.example/status/8',
      position: 8,
      extractedJapaneseTitle: '灰宮先輩は怖くてかわいい',
      confidence: 'HIGH',
      clusterId: 'lens-灰宮先輩は怖くてかわいい',
    });
  });

  it('deduplicates source hosts without merging titles that differ by a Japanese particle', () => {
    const candidates = rankLensCandidates(lensResults);
    const mainTitle = candidates.find((candidate) => candidate.candidateTitle === '灰宮先輩は怖くてかわいい');
    const alternateTitle = candidates.find((candidate) => candidate.candidateTitle === '灰宮先輩が怖くてかわいい');

    expect(mainTitle?.independentSourceCount).toBe(2);
    expect(alternateTitle).toBeDefined();
    expect(alternateTitle?.normalizedTitle).not.toBe(mainTitle?.normalizedTitle);
  });

  it('selects at most two distinct, highest-ranked title queries', () => {
    const candidates = rankLensCandidates(lensResults);
    const queries = selectLensQueries(candidates, 2);

    expect(queries).toEqual([
      '灰宮先輩は怖くてかわいい 漫画',
      '灰宮先輩が怖くてかわいい 漫画',
    ]);
    expect(new Set(queries)).toHaveProperty('size', 2);
  });

  it('does not assign high title confidence to incidental Japanese phrases in long SNS/page titles', () => {
    const candidates = rankLensCandidates([
      {
        title: 'X on X: "アニメの話も何度目かですが、今日は別の作品について感想を投稿します" / X',
        source: 'X',
        link: 'https://x.example/status/noisy',
        position: 1,
      },
      {
        title: 'Instagram post',
        source: 'Instagram',
        link: 'https://www.instagram.com/p/direct-title',
        position: 3,
        snippet: '#放課後のアイドルには秘密がある',
      },
    ]);

    const noisyCandidates = candidates.filter((candidate) => candidate.url === 'https://x.example/status/noisy');
    expect(noisyCandidates.length).toBeGreaterThan(0);
    expect(noisyCandidates.every((candidate) => candidate.confidence === 'LOW')).toBe(true);
    expect(candidates.find((candidate) => candidate.candidateTitle === '放課後のアイドルには秘密がある')?.confidence).toBe('HIGH');
  });

  it('extracts a quoted work title from an article suffix without promoting the full article', () => {
    const candidates = rankLensCandidates([{
      title: '放課後のアイドルには秘密がある」アニメ化決定！キャスト発表 - ニュース',
      source: 'News',
      link: 'https://news.example/anime-announcement',
      position: 45,
    }]);

    const titleCandidate = candidates.find((candidate) => candidate.candidateTitle === '放課後のアイドルには秘密がある');
    expect(titleCandidate).toBeDefined();
    expect(titleCandidate?.confidence).toBe('MEDIUM');
    expect(titleCandidate?.candidateTitle).not.toContain('アニメ化');
  });
});