import { describe, expect, it } from 'vitest';
import type { Candidate, PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline, type ResearchProviders } from '../../src/lib/pipeline/identify-pipeline';
import type { LensMatch, ResearchBundle, WebSearchResult } from '../../src/lib/search/types';
import { compactCanonicalResolverResearch } from '../../src/lib/ai/prompts';
import { instagramOcrText } from '../fixtures/instagram-ocr';
import { findVerifiedOcrCorrections, verifiedOcrWorkTitles } from '../../src/lib/search/work-title-verification';

const image: PreparedImage = {
  buffer: Buffer.from('synthetic-image'),
  mimeType: 'image/png',
  width: 800,
  height: 1200,
};

const candidate: Candidate = {
  rank: 1,
  japaneseTitle: '灰宮先輩は怖くてかわいい',
  koreanTitle: '회궁 선배는 무섭고 귀여워',
  koreanTitleStatus: 'OFFICIAL',
  publicationStatus: 'CONFIRMED',
  confidence: 'HIGH',
  evidence: ['WORK_TITLE_MATCH'],
  author: null,
  koreanInvestigationStatus: 'SUCCESS',
};

const lensMatches: LensMatch[] = [
  { title: 'AI chatbot for manga fans', source: 'Assistant App', link: 'https://assistant.example/app', position: 1 },
  { title: 'Pinterest manga collection', source: 'Pinterest', link: 'https://pinterest.example/collection', position: 2 },
  { title: '漫画おすすめアプリ', source: 'App Store', link: 'https://apps.example/manga', position: 3 },
  { title: 'Xの投稿', source: 'X', link: 'https://x.example/status/8?api_key=fixture-secret', position: 8, snippet: '新作漫画 #灰宮先輩は怖くてかわいい' },
  { title: '灰宮先輩は怖くてかわいい！公式連載ページ', source: '連載サイト', link: 'https://serial.example/work', position: 9 },
  { title: '#灰宮先輩が怖くてかわいい', source: 'X', link: 'https://x.example/status/10', position: 10 },
];

function result(title: string, url: string, content: string): WebSearchResult {
  return { title, url, content, score: 0.9 };
}

describe('Lens-based candidate pipeline', () => {
  it.each(['ambiguous', 'untrusted'])('does not guess an OCR correction from %s evidence', (kind) => {
    const titles = ['灰宮先輩は怖くてかわいい', '灰宮先輩は怖くて優しい'];
    const results = titles.slice(0, kind === 'ambiguous' ? 2 : 1).map((title, index) => ({
      title, url: kind === 'ambiguous' ? `https://www.kadokawa.co.jp/mock-${index}` : 'https://unknown.example/work',
      content: `${title} 漫画 公式連載`, score: 0.9,
    }));
    expect(findVerifiedOcrCorrections(['灰宮先生は'], results)).toEqual([]);
  });

  it('requires a full manga title and trustworthy or independent publication evidence', () => {
    const title = '星空の図書館';
    expect(verifiedOcrWorkTitles([title], [result(title, 'https://www.shueisha.co.jp/work', '漫画 公式連載')])).toEqual([title]);
    expect(verifiedOcrWorkTitles([title], [result('星空の', 'https://www.shueisha.co.jp/work', '漫画 公式連載')])).toEqual([]);
    expect(verifiedOcrWorkTitles([title], [result(title, 'https://shueisha.co.jp.evil.example/work', '漫画 公式連載')])).toEqual([]);
    expect(verifiedOcrWorkTitles([title], [
      result(title, 'https://catalog.example/work', '漫画 作者と連載情報'),
      result(title, 'https://serial.example/work', '漫画 作者と連載情報'),
    ])).toEqual([title]);
    expect(verifiedOcrWorkTitles([title], [
      result(title, 'https://one.catalog.example/work', '漫画 作者と連載情報'),
      result(title, 'https://two.catalog.example/work', '漫画 作者と連載情報'),
    ])).toEqual([]);
  });

  it('does not identify Japanese manga from a Korean bookstore Lens match alone', async () => {
    let judgmentCalls = 0;
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: '', valid: false }),
      tavily: async () => [],
      lens: async () => [{ title: candidate.japaneseTitle, source: 'YES24', link: 'https://www.yes24.com/work' }],
      judge: async () => { judgmentCalls += 1; return [candidate]; },
    });
    expect(outcome.status).toBe('INSUFFICIENT');
    expect(judgmentCalls).toBe(0);
  });

  it.each(['https://www.yes24.com/work', 'https://www.nl.go.kr/work'])('does not verify Japanese identity from %s', async (url) => {
    let lensCalls = 0;
    const title = '星空の図書館';
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: title, valid: true }),
      tavily: async () => [result(title, url, '漫画 公式連載')],
      lens: async () => { lensCalls += 1; return []; },
      judge: async () => [{ ...candidate, japaneseTitle: title }],
    });
    expect(lensCalls).toBe(1);
    expect(outcome.candidates).toEqual([]);
  });

  it('skips judgment when OCR candidates have no search or visual evidence', async () => {
    let judgmentCalls = 0;
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: '星空の図書館', valid: true }),
      tavily: async () => [],
      lens: async () => [],
      judge: async () => { judgmentCalls += 1; return [candidate]; },
    });
    expect(outcome.status).toBe('INSUFFICIENT');
    expect(judgmentCalls).toBe(0);
  });

  it('retains conflicting OCR and Lens evidence without returning HIGH confidence', async () => {
    const title = '放課後のアイドルには秘密がある';
    let lensCalls = 0;
    let canonical: ResearchBundle | undefined;
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: instagramOcrText, rawText: instagramOcrText, valid: true }),
      tavily: async (query) => query.includes('한국') ? [] : [
        result(title, 'https://www.hakusensha.co.jp/work', '漫画 公式連載'),
        result(candidate.japaneseTitle, 'https://www.shueisha.co.jp/other', '漫画 公式連載'),
      ],
      lens: async () => { lensCalls += 1; return lensMatches; },
      judge: async (bundle) => {
        if (!bundle.koreanResults) canonical = bundle;
        return [{ ...candidate, japaneseTitle: title }];
      },
    });
    expect(lensCalls).toBe(1);
    expect(canonical?.ocrTitleCandidates).toContain(title);
    expect(canonical?.lensMatches).toHaveLength(lensMatches.length);
    expect(outcome.candidates[0]?.japaneseTitle).toBe(title);
    expect(outcome.candidates[0]?.confidence).toBe('LOW');
  });

  it('does not accept a partial model title when the whole OCR title is verified', async () => {
    const title = '放課後のアイドルには秘密がある';
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: instagramOcrText, rawText: instagramOcrText, valid: true }),
      tavily: async () => [result(title, 'https://www.hakusensha.co.jp/work', '漫画 公式連載')],
      lens: async () => [],
      judge: async () => [{ ...candidate, japaneseTitle: '放課後のアイドル' }],
    });
    expect(outcome.candidates).toEqual([]);
  });

  it.each([
    { content: '漫画 公式連載 作者の作品情報', expectedLensCalls: 0 },
    { content: '読者のコメントと感想', expectedLensCalls: 1 },
  ])('verifies the reconstructed OCR work instead of counting results: $content', async ({ content, expectedLensCalls }) => {
    let lensCalls = 0;
    let ocrCalls = 0;
    const japaneseQueries: string[] = [];
    const bundles: ResearchBundle[] = [];
    const title = '放課後のアイドルには秘密がある';
    await runIdentifyPipeline([image], {
      ocr: async () => { ocrCalls += 1; return { text: instagramOcrText, rawText: instagramOcrText, valid: false }; },
      refineOcr: async (rawText) => ({ rawText, titleCandidates: [], dialogueCandidates: ['秘密がある'], noise: [], queryType: 'DIALOGUE' }),
      tavily: async (query) => {
        if (query.includes('한국')) return [];
        japaneseQueries.push(query);
        return [result(title, 'https://www.hakusensha.co.jp/work', content)];
      },
      lens: async () => { lensCalls += 1; return lensMatches; },
      judge: async (bundle) => { bundles.push(bundle); return [{ ...candidate, japaneseTitle: title }]; },
    });

    expect(ocrCalls).toBe(1);
    expect(lensCalls).toBe(expectedLensCalls);
    expect(japaneseQueries[0]).toBe(`"${title}" 漫画`);
    expect(japaneseQueries.length).toBeLessThanOrEqual(4);
    expect(bundles[0]?.ocrTitleCandidates).toContain(title);
    expect(bundles[0]?.rawOcrText).toBe(instagramOcrText);
    const compact = compactCanonicalResolverResearch(bundles[0]) as Partial<ResearchBundle>;
    expect(compact.rawOcrText).toBe(instagramOcrText);
    expect(compact.ocrTitleCandidates).toContain(title);
    if (expectedLensCalls) {
      expect(bundles[0]?.lensMatches).toHaveLength(lensMatches.length);
      expect(bundles[0]?.candidateSeeds).toContain(title);
    } else {
      expect(bundles[0]?.verifiedOcrTitles).toContain(title);
    }
  });

  it('uses Lens for dialogue-only OCR even when a partial Tavily match exists', async () => {
    let lensCalls = 0;
    await runIdentifyPipeline([image], {
      ocr: async () => ({ text: 'そんなこと\n俺が知るか', valid: true }),
      tavily: async () => [result('君の膵臓をたべたい', 'https://publisher.example/other', 'そんなこと 漫画 公式連載')],
      lens: async () => { lensCalls += 1; return []; },
      judge: async () => [],
    });
    expect(lensCalls).toBe(1);
  });

  it('rejects an unrelated famous model choice despite verified full OCR title evidence', async () => {
    let judgmentCalls = 0;
    const title = '放課後のアイドルには秘密がある';
    const outcome = await runIdentifyPipeline([image], {
      ocr: async () => ({ text: instagramOcrText, rawText: instagramOcrText, valid: true }),
      tavily: async () => [result(title, 'https://www.hakusensha.co.jp/work', '漫画 公式連載')],
      lens: async () => { throw new Error('Verified OCR must skip Lens'); },
      judge: async () => { judgmentCalls += 1; return [{ ...candidate, japaneseTitle: '君の膵臓をたべたい' }]; },
    });
    expect(outcome.candidates).toEqual([]);
    expect(outcome.status).toBe('INSUFFICIENT');
    expect(judgmentCalls).toBe(1);
  });

  it('uses two distinct candidate queries and scopes Tavily evidence before Foundry', async () => {
    const japaneseQueries: string[] = [];
    const canonicalBundles: ResearchBundle[] = [];
    let judgmentCalls = 0;
    const providers: ResearchProviders = {
      ocr: async () => ({ text: '', valid: false }),
      lens: async () => lensMatches,
      tavily: async (query) => {
        if (query.includes('한국')) return [result('공식 한국어판', 'https://publisher.example/ko', '정발 판매')];
        japaneseQueries.push(query);
        if (query.includes('灰宮先輩は怖くてかわいい')) return [
          result('AI chatbot companion', 'https://assistant.example/work', 'An AI assistant app for readers'),
        ];
        if (query.includes('灰宮先輩が怖くてかわいい')) return [
          result('灰宮先輩が怖くてかわいい 漫画', 'https://alt.example/title', '灰宮先輩が怖くてかわいい 漫画'),
        ];
        return [result('unrelated result', 'https://unrelated.example/page', 'generic service')];
      },
      judge: async (bundle) => {
        judgmentCalls += 1;
        if (!bundle.koreanResults) canonicalBundles.push(bundle);
        return [candidate];
      },
    };

    const resultValue = await runIdentifyPipeline([image], providers);
    const research = canonicalBundles[0];

    expect(japaneseQueries).toEqual([
      '灰宮先輩は怖くてかわいい 漫画',
      '灰宮先輩が怖くてかわいい 漫画',
    ]);
    expect(research?.candidateSeeds).toContain('灰宮先輩は怖くてかわいい');
    expect(research?.candidateSeeds).not.toContain('AI chatbot companion');
    expect(research?.tavilyResults.map((item) => item.url)).toEqual(expect.arrayContaining([
      'https://alt.example/title',
    ]));
    expect(research?.tavilyResults.some((item) => item.searchCandidateTitle === '灰宮先輩が怖くてかわいい')).toBe(true);
    expect(research?.tavilyResults.some((item) => item.url.includes('assistant.example'))).toBe(false);
    expect(judgmentCalls).toBe(2);
    expect(resultValue.status).toBe('SUCCESS');

    const compactResearch = compactCanonicalResolverResearch(research) as {
      candidateClusters: Array<{
        candidateTitle: string;
        lensEvidence: Array<{ sourceUrl: string; lensPosition: number; evidenceType: string }>;
        tavilyEvidence: Array<{ url: string; searchQuery?: string }>;
        conflictingEvidence: Array<{ title: string; sourceDomain: string }>;
      }>;
      tavilyResults?: unknown[];
    };
    const mainCluster = compactResearch.candidateClusters.find((cluster) => cluster.candidateTitle === '灰宮先輩は怖くてかわいい');
    expect(mainCluster?.lensEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceUrl: 'https://x.example/status/8', lensPosition: 8, evidenceType: 'HASHTAG' }),
    ]));
    expect(mainCluster?.conflictingEvidence).toContainEqual({ title: 'AI chatbot companion', sourceDomain: 'assistant.example' });
    expect(compactResearch.tavilyResults).toBeUndefined();
    expect(JSON.stringify(compactResearch)).not.toContain('fixture-secret');
    expect(JSON.stringify(compactResearch)).not.toContain('An AI assistant app for readers');
  });
});