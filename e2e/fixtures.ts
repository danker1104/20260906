import { expect, test as base } from '@playwright/test';

const externalApiHosts = [
  'www.nl.go.kr',
  'apis.yes24.com',
  'api.tavily.com',
  'serpapi.com',
  'api.ocr.space',
  'cognitiveservices.azure.com',
  'services.ai.azure.com',
  'ai.azure.com',
];

export const test = base.extend<{ noExternalApiRequests: void }>({
  noExternalApiRequests: [async ({ page }, use) => {
    const attemptedRequests: string[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const isExternalApi = externalApiHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
      const hasCredentialQuery = [...url.searchParams.keys()].some((key) => /api[_-]?key|token|secret|auth|cert[_-]?key/iu.test(key));
      const hasCredentialHeader = Object.keys(route.request().headers()).some((key) => /^(?:api[_-]?key|authorization|x-api-key)$/iu.test(key));
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isExternalApi || (!isLocal && (hasCredentialQuery || hasCredentialHeader))) {
        attemptedRequests.push(url.hostname);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await use();
    expect(attemptedRequests, 'E2E tests must not call external API providers').toEqual([]);
  }, { auto: true }],
});

export { expect };