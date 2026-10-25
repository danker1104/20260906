import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IdentifyResponse } from '../../src/lib/domain/types';
import { ResultPanel } from '../../src/components/results/result-panel';
import { mapPipelineResponse } from '../../src/lib/pipeline/response-mapper';

const responseWithYes24: IdentifyResponse = {
  status: 'SUCCESS',
  requestId: '11111111-1111-4111-8111-111111111111',
  stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'SUCCESS' },
  candidates: [{
    rank: 1,
    japaneseTitle: '作品名',
    koreanTitle: '작품명',
    koreanTitleStatus: 'OFFICIAL',
    publicationStatus: 'CONFIRMED',
    confidence: 'HIGH',
    evidence: ['WORK_TITLE_MATCH'],
    author: '작가',
    koreanInvestigationStatus: 'SUCCESS',
    yes24: {
      matched: true,
      itemId: 'yes24-item',
      title: '작품명 1권',
      productUrl: 'https://www.yes24.com/Product/Goods/yes24-item',
      publisher: '출판사',
    },
  }],
};

describe('ResultPanel YES24 enrichment display', () => {
  it.each(['both', 'namu-only', 'yes24-only'])('preserves Case 05 links through API mapping and independent UI rendering: %s', (mode) => {
    const namuWikiUrl = `https://namu.wiki/w/${encodeURIComponent('정반대의 너와 나')}`;
    const productUrl = 'https://www.yes24.com/product/goods/184510430';
    const mapped = mapPipelineResponse(responseWithYes24.requestId, {
      status: 'SUCCESS', stages: responseWithYes24.stages,
      candidates: [{ ...responseWithYes24.candidates[0]!, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대의 너와 나', confidence: 'LOW',
        ...(mode !== 'yes24-only' ? { namuWikiUrl } : {}),
        yes24: mode === 'namu-only' ? { matched: false } : { matched: true, itemId: '184510430', title: '정반대의 너와 나 1권',
          publisher: '학산문화사', coverUrl: 'https://image.yes24.com/mock-case05-cover.jpg', productUrl },
      }],
    });
    const html = renderToStaticMarkup(createElement(ResultPanel, { result: mapped }));
    expect(html.includes('나무위키에서 보기')).toBe(mode !== 'yes24-only');
    expect(html.includes('YES24 한국판 도서 정보')).toBe(mode !== 'namu-only');
    if (mode !== 'yes24-only') expect(mapped.candidates[0]?.namuWikiUrl).toBe(namuWikiUrl);
    if (mode !== 'namu-only') {
      expect(mapped.candidates[0]?.yes24?.productUrl).toBe(productUrl);
      expect(html).toContain(`class="yes24-cover-link" href="${productUrl}"`);
      expect(html).toContain('학산문화사');
    }
  });

  it('renders a matched YES24 product and purchase link even when coverUrl is absent', () => {
    const html = renderToStaticMarkup(createElement(ResultPanel, { result: responseWithYes24 }));

    expect(html).toContain('YES24 한국판 도서 정보');
    expect(html).toContain('작품명 1권');
    expect(html).toContain('출판사');
    expect(html).toContain('표지 없음');
    expect(html).toContain('https://www.yes24.com/Product/Goods/yes24-item');
    expect(html).toContain('YES24에서 보기');
    expect(html).not.toContain('<img');
  });
});

describe('ResultPanel NamuWiki link', () => {
  it('renders a verified document link in a new tab', () => {
    const namuWikiUrl = `https://namu.wiki/w/${encodeURIComponent('작품명')}`;
    const result = { ...responseWithYes24, candidates: [{ ...responseWithYes24.candidates[0]!, namuWikiUrl }] };
    const html = renderToStaticMarkup(createElement(ResultPanel, { result }));

    expect(html).toContain(`href="${namuWikiUrl}"`);
    expect(html).toContain('나무위키에서 보기');
    expect(html).toContain('작품명 나무위키에서 보기 (새 탭)');
    expect(html).toMatch(/href="https:\/\/namu\.wiki\/w\/[^"]+"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/u);
  });

  it('hides the link when no document was verified', () => {
    const html = renderToStaticMarkup(createElement(ResultPanel, { result: responseWithYes24 }));
    expect(html).not.toContain('나무위키');
  });

  it.each(['javascript:alert(1)', 'https://namu.wiki.evil.example/w/test', 'https://namu.wiki/Search?q=test'])(
    'does not render an unsafe or non-document link: %s',
    (namuWikiUrl) => {
      const result = { ...responseWithYes24, candidates: [{ ...responseWithYes24.candidates[0]!, namuWikiUrl }] };
      const html = renderToStaticMarkup(createElement(ResultPanel, { result }));
      expect(html).not.toContain('나무위키');
    },
  );
});
