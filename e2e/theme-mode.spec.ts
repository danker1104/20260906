import { expect, test } from './fixtures';

test('opens the homepage without a blocking intro or unsupported install action', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.intro-scene')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '이 만화, 뭐였지?' })).toBeVisible();
  await expect(page.getByRole('button', { name: '설치하기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '홈 화면에 추가하기' })).toHaveCount(0);
});

test('keeps the publication header spaced and persists its theme choice', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/publication');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: '출판 정보 검색' })).toBeVisible();

  const headerGaps = await page.evaluate(() => {
    const brand = document.querySelector('.topbar .brand')!.getBoundingClientRect();
    const nav = document.querySelector('.topbar nav')!.getBoundingClientRect();
    const toggle = document.querySelector('.topbar .theme-toggle')!.getBoundingClientRect();
    return { brandToNav: nav.left - brand.right, navToToggle: toggle.left - nav.right };
  });
  expect(headerGaps.brandToNav).toBeGreaterThan(8);
  expect(headerGaps.navToToggle).toBeGreaterThan(8);

  const themeToggle = page.getByRole('button', { name: '라이트 모드로 전환' });
  await expect(themeToggle).toHaveText('');
  await expect(themeToggle).toHaveAttribute('title', '라이트 모드로 전환');
  await themeToggle.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.locator('#publication-query').evaluate((input) => getComputedStyle(input).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('keeps image search upload-first and shows keyboard focus on its dropzone', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: '장면을 선택하세요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '출판 정보 검색' })).toBeVisible();
  await expect(page.getByRole('button', { name: '라이트 모드로 전환' })).toHaveText('');
  await expect(page.locator('main.app-shell > section.hero')).toHaveCount(0);
  await page.locator('#manga-images').focus();
  const uploadFocusVisible = await page.locator('.upload-dropzone').evaluate((dropzone) => {
    const style = getComputedStyle(dropzone);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  });
  expect(uploadFocusVisible).toBe(true);
});