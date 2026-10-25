import { vi } from 'vitest';

process.env.NL_API_MODE = 'mock';
process.env.NL_API_KEY = '';
process.env.NL_API_CACHE_TTL_MS = '0';
process.env.OCR_SPACE_API_KEY = '';
process.env.TAVILY_API_KEY = '';
process.env.SERPAPI_API_KEY = '';
process.env.YES24_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.AZURE_FOUNDRY_ENDPOINT = '';
process.env.AZURE_FOUNDRY_API_KEY = '';

vi.stubGlobal('fetch', vi.fn(async () => {
  throw new Error('External network access is disabled in automated tests.');
}));