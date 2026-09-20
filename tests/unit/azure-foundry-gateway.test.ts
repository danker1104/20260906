import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AzureFoundryConfigurationError,
  createAzureFoundryGateway,
} from '../../src/lib/ai/azure-foundry-gateway';

describe('Azure Foundry gateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('calls the server-side OpenAI-compatible endpoint with structured JSON output', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://example.services.ai.azure.com');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'test-key');
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"candidates":[]}' } }],
    }), { status: 200 }));

    const result = await createAzureFoundryGateway().generateContent({
      model: 'manga-judge',
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toBe('{"candidates":[]}');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.services.ai.azure.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': 'test-key' },
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'manga-judge',
      response_format: { type: 'json_object' },
      temperature: 0,
    });
  });

  it('fails closed when server-side Foundry configuration is missing', () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', '');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    vi.stubEnv('AZURE_FOUNDRY_MODEL', '');
    expect(() => createAzureFoundryGateway()).toThrow(AzureFoundryConfigurationError);
  });
});
