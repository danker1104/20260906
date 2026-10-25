import { expect, test } from './fixtures';

test.setTimeout(45_000);

// These flows hit the real /api/publication/* routes without any page.route mocking —
// NL_API_MODE defaults to 'mock' server-side, so no real external API call occurs.
test('searches the Publication Search page and shows the mock-data banner with grouped volumes', async ({ page }) => {
  await page.goto('/publication');
  await expect(page.getByRole('heading', { name: '출판 정보 검색' })).toBeVisible();
  // Wait for client hydration to finish so the controlled input's onChange is wired up
  // before filling it — otherwise a fill() that lands before hydrate() is silently lost.
  await page.waitForLoadState('networkidle');

  await page.getByPlaceholder('만화 제목 또는 ISBN 입력…').pressSequentially('테스트 작품 A');
  await page.getByRole('button', { name: '검색' }).click();

  await expect(page.getByRole('status')).toContainText('개발용 Mock 데이터');
  await expect(page.getByRole('heading', { name: '[Mock] 테스트 작품 A' })).toBeVisible();
  await expect(page.getByText(/현재 검색된 5권/)).toBeVisible();
});

test('filters volumes by status without issuing a new search request', async ({ page }) => {
  await page.goto('/publication?q=테스트 작품 A');

  await expect(page.getByRole('heading', { name: '[Mock] 테스트 작품 A' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('combobox', { name: '출판 상태 필터' }).selectOption('DEPOSITED');

  await expect(page.getByText('[Mock] 테스트 작품 A 1권')).toBeVisible();
  await expect(page.getByText('[Mock] 테스트 작품 A 3권')).toHaveCount(0);
});

test('keeps a similarly titled novel in collapsed additional results', async ({ page }) => {
  await page.goto('/publication?q=테스트 작품 A');

  await expect(page.getByRole('heading', { name: '[Mock] 테스트 작품 A' })).toBeVisible({ timeout: 15_000 });
  const novelHeading = page.getByRole('heading', { name: '[Mock] 테스트 작품 A 소설판' });
  await expect(novelHeading).toBeHidden({ timeout: 15_000 });
  await page.getByText('추가 검색 결과 (1)').click();
  await expect(novelHeading).toBeVisible();
});

test('keeps an exact-title result with missing manga metadata in the primary results', async ({ page }) => {
  await page.goto('/publication?q=엣지%20ISBN%20없음');

  await expect(page.getByRole('heading', { name: '[Mock] 테스트 작품 엣지 ISBN 없음' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('유형 미확인')).toBeVisible();
});

test('checking purchase info in mock mode never calls a real external API', async ({ page }) => {
  await page.goto('/publication?q=테스트 작품 A');

  await expect(page.getByRole('heading', { name: '[Mock] 테스트 작품 A' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '구매 정보 확인' }).first().click();

  await expect(page.getByText('Mock 모드에서는 구매 정보를 조회하지 않아요.')).toBeVisible();
});

test('entering the page without a query param issues no search request', async ({ page }) => {
  let searchRequested = false;
  await page.route('**/api/publication/search**', (route) => {
    searchRequested = true;
    return route.continue();
  });

  await page.goto('/publication');
  await page.waitForTimeout(300);

  expect(searchRequested).toBe(false);
});
