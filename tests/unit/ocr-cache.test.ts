import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../src/lib/domain/types';
import { extractJapaneseText, readSocialCropBounds } from '../../src/lib/search/ocr-space';

describe('OCR research cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('finds central image bounds only when both social header and footer UI are detected', () => {
    const parsedResults = [{
      TextOverlay: {
        Lines: [
          { LineText: '@creator Following', MinTop: 96, MaxHeight: 42, Words: [] },
          { LineText: '128 likes 8 comments Share Save', MinTop: 1_680, MaxHeight: 64, Words: [] },
        ],
      },
    }];

    const bounds = readSocialCropBounds(parsedResults, 1_920);

    expect(bounds?.top).toBeLessThan(200);
    expect(bounds?.bottom).toBeGreaterThan(1_680);
    if (bounds) expect(bounds.bottom - bounds.top).toBeGreaterThan(1_000);
    expect(readSocialCropBounds([{ TextOverlay: { Lines: [parsedResults[0]?.TextOverlay.Lines[0]!] } }], 1_920)).toBeUndefined();
  });

  it('reuses OCR output for identical prepared image bytes', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      IsErroredOnProcessing: false,
      OCRExitCode: 1,
      ParsedResults: [{ ParsedText: '『作品名』' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const image: PreparedImage = {
      buffer: Buffer.from(`cache-test-${Math.random()}`),
      mimeType: 'image/png',
      width: 240,
      height: 320,
    };

    const first = await extractJapaneseText(image);
    const second = await extractJapaneseText({ ...image, imageIndex: 2, buffer: Buffer.from(image.buffer) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get('isOverlayRequired')).toBe('true');
    expect(second).toEqual(first);
    expect(second.valid).toBe(true);
    expect(second.ocrConfidence).toBeUndefined();
  });

  it('uses OCR.space confidence metadata only when it is present', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      IsErroredOnProcessing: false,
      OCRExitCode: 1,
      ParsedResults: [{
        ParsedText: '放課後のアイ',
        TextOverlay: { Lines: [{ Words: [{ Confidence: '24.5' }] }] },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const image: PreparedImage = {
      buffer: Buffer.from(`confidence-test-${Math.random()}`),
      mimeType: 'image/png',
      width: 240,
      height: 320,
    };

    const extraction = await extractJapaneseText(image);

    expect(extraction.valid).toBe(true);
    expect(extraction.ocrConfidence).toBe(24.5);
  });

  it.each([
    { name: 'separate character lines', grouped: false },
    { name: 'characters grouped into horizontal OCR rows', grouped: true },
  ])('joins vertical Japanese $name top-to-bottom and right-to-left', async ({ grouped }) => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-key');
    const words = [
      { WordText: '図', Left: 100, Top: 20, Width: 20, Height: 20 },
      { WordText: '星', Left: 130, Top: 20, Width: 20, Height: 20 },
      { WordText: '書', Left: 100, Top: 44, Width: 20, Height: 20 },
      { WordText: '空', Left: 130, Top: 44, Width: 20, Height: 20 },
      { WordText: '館', Left: 100, Top: 68, Width: 20, Height: 20 },
      { WordText: 'の', Left: 130, Top: 68, Width: 20, Height: 20 },
    ];
    const lines = grouped
      ? [0, 2, 4].map((index) => ({ Words: words.slice(index, index + 2) }))
      : words.map((word) => ({ LineText: word.WordText, Words: [word] }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ParsedResults: [{ ParsedText: '図 星\n書 空\n館 の', TextOverlay: { Lines: lines } }],
    }), { status: 200 }));

    const extraction = await extractJapaneseText({
      buffer: Buffer.from(`vertical-${grouped}`), mimeType: 'image/png', width: 400, height: 600,
    });

    expect(extraction.text).toBe('星空の図書館');
    expect(extraction.rawText).toBe('星空の図書館');
    expect(extraction.lines).toEqual([
      { text: '星空の図書館', left: 100, top: 20, width: 50, height: 68 },
    ]);
    expect(extraction.valid).toBe(true);
  });

  it('preserves original text and numeric word bounds from a mocked overlay', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ParsedResults: [{
        ParsedText: '星空の\n図書館',
        TextOverlay: { Lines: [
          { LineText: '星空の', MinTop: '100', MaxHeight: '30', Words: [{ WordText: '星空の', Left: '40', Top: '100', Width: '120', Height: '30' }] },
          { LineText: '図書館', Words: [{ WordText: '図書館', Left: '45', Top: '135', Width: '100', Height: '30' }] },
        ] },
      }],
    }), { status: 200 }));
    const extraction = await extractJapaneseText({
      buffer: Buffer.from('mock-overlay-bounds'), mimeType: 'image/png', width: 400, height: 600,
    });
    expect(extraction.rawText).toBe('星空の\n図書館');
    expect(extraction.lines).toEqual([
      { text: '星空の', top: 100, height: 30, left: 40, width: 120 },
      { text: '図書館', top: 135, height: 30, left: 45, width: 100 },
    ]);
    extraction.lines![0].text = 'changed by caller';
    const cached = await extractJapaneseText({
      buffer: Buffer.from('mock-overlay-bounds'), mimeType: 'image/png', width: 400, height: 600,
    });
    expect(cached.lines?.[0]?.text).toBe('星空の');
  });

  it.each([
    {
      name: 'diagonal individual characters',
      rawText: '星\n空\nの',
      words: [
        { WordText: '星', Left: 100, Top: 20, Width: 20, Height: 20 },
        { WordText: '空', Left: 106, Top: 44, Width: 20, Height: 20 },
        { WordText: 'の', Left: 112, Top: 68, Width: 20, Height: 20 },
      ],
      expected: '星\n空\nの',
    },
    {
      name: 'diagonally staggered tall words',
      rawText: '星空の\n図書館',
      words: [
        { WordText: '星空の', Left: 100, Top: 20, Width: 20, Height: 68 },
        { WordText: '図書館', Left: 130, Top: 44, Width: 20, Height: 68 },
      ],
      expected: '星空の\n図書館',
    },
    {
      name: 'horizontal characters alongside vertical text',
      rawText: '星 空 の\n図書館',
      words: [
        { WordText: '星', Left: 100, Top: 20, Width: 20, Height: 20 },
        { WordText: '空', Left: 124, Top: 20, Width: 20, Height: 20 },
        { WordText: 'の', Left: 148, Top: 20, Width: 20, Height: 20 },
        { WordText: '図書館', Left: 300, Top: 20, Width: 20, Height: 68 },
      ],
      expected: '星 空 の\n図書館',
    },
    {
      name: 'complete vertical columns with punctuation and a horizontal caption',
      rawText: '図書館。\n星空の\n作品紹介',
      words: [
        { WordText: '図書館。', Left: 100, Top: 20, Width: 20, Height: 90 },
        { WordText: '星空の', Left: 130, Top: 20, Width: 20, Height: 68 },
        { WordText: '作品紹介', Left: 100, Top: 200, Width: 120, Height: 20 },
      ],
      expected: '星空の図書館。\n作品紹介',
    },
    {
      name: 'distant speech bubbles',
      rawText: '待って！\n本当？',
      words: [
        { WordText: '待って！', Left: 300, Top: 20, Width: 20, Height: 90 },
        { WordText: '本当？', Left: 30, Top: 20, Width: 20, Height: 68 },
      ],
      expected: '待って！\n本当？',
    },
    {
      name: 'vertically distant fragments in the same column',
      rawText: '星空の\n図書館',
      words: [
        { WordText: '星空の', Left: 100, Top: 20, Width: 20, Height: 68 },
        { WordText: '図書館', Left: 100, Top: 400, Width: 20, Height: 68 },
      ],
      expected: '星空の\n図書館',
    },
    {
      name: 'missing coordinates',
      rawText: '図書館\n星空の',
      words: [
        { WordText: '図書館', Left: 100, Top: 20, Width: 20, Height: 68 },
        { WordText: '星空の', Left: 130, Width: 20, Height: 68 },
      ],
      expected: '図書館\n星空の',
    },
    {
      name: 'incomplete overlay text',
      rawText: '星空の図書館\n作品紹介',
      words: [
        { WordText: '図書館', Left: 100, Top: 20, Width: 20, Height: 68 },
        { WordText: '星空の', Left: 130, Top: 20, Width: 20, Height: 68 },
      ],
      expected: '星空の図書館\n作品紹介',
    },
  ])('handles $name without losing text or joining unrelated regions', async ({ name, rawText, words, expected }) => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ParsedResults: [{ ParsedText: rawText, TextOverlay: { Lines: words.map((word) => ({ LineText: word.WordText, Words: [word] })) } }],
    }), { status: 200 }));

    const extraction = await extractJapaneseText({
      buffer: Buffer.from(name), mimeType: 'image/png', width: 400, height: 600,
    });

    expect(extraction.rawText).toBe(expected);
  });
});