import { expect, test } from '@playwright/test';

const onePixelPng = {
  name: 'manga.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
};

const successResponse = {
  status: 'SUCCESS',
  requestId: '11111111-1111-4111-8111-111111111111',
  stages: {
    imageAnalysis: 'SUCCESS',
    finalJudgment: 'SUCCESS',
  },
  candidates: [{
    rank: 1,
    japaneseTitle: '星の下の彼女',
    koreanTitle: '별 아래의 그녀',
    koreanTitleStatus: 'COMMON',
    publicationStatus: 'NOT_FOUND',
    confidence: 'HIGH',
    evidence: ['DIALOGUE_MATCH'],
    author: '山田太郎',
    koreanInvestigationStatus: 'SUCCESS',
  }],
};

test('homepage explains the service and links to the search app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '이 만화, 뭐였지?' })).toBeVisible();
  await expect(page.getByText('캡처에서 제목까지,')).toBeVisible();
  await page.getByRole('link', { name: '이미지로 만화 찾기' }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('heading', { name: '장면을 선택하세요' })).toBeVisible();
});

test('uploads an image and renders a successful candidate', async ({ page }) => {
  await page.route('**/api/identify', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(successResponse) }));
  await page.goto('/search');
  await page.locator('#manga-images').setInputFiles(onePixelPng);
  await expect(page.getByText('manga.png')).toBeVisible();
  await page.getByRole('button', { name: '만화 찾기' }).click();
  await expect(page.getByRole('heading', { name: '星の下の彼女' })).toBeVisible();
  await expect(page.getByText('별 아래의 그녀')).toBeVisible();
  await expect(page.getByText('국내 통용명')).toBeVisible();
});

test('renders a partial result without inventing Korean information', async ({ page }) => {
  await page.route('**/api/identify', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...successResponse,
      status: 'PARTIAL_SUCCESS',
      stages: { ...successResponse.stages, koreanInvestigation: 'FAILED' },
      candidates: [{ ...successResponse.candidates[0], koreanTitle: null, koreanTitleStatus: 'UNKNOWN', publicationStatus: 'UNKNOWN', koreanInvestigationStatus: 'FAILED' }],
    }),
  }));
  await page.goto('/search');
  await page.locator('#manga-images').setInputFiles(onePixelPng);
  await page.getByRole('button', { name: '만화 찾기' }).click();
  await expect(page.getByText('일부 후보의 한국 정보가 확인되지 않았습니다.')).toBeVisible();
  await expect(page.getByText('한국어 제목 확인 불충분')).toBeVisible();
});
