export interface AzureFoundryGenerateRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface AzureFoundryGateway {
  generateContent(request: AzureFoundryGenerateRequest): Promise<string>;
}

export class AzureFoundryConfigurationError extends Error {
  constructor() {
    super('Azure Foundry endpoint, API key 또는 model이 설정되지 않았습니다.');
    this.name = 'AzureFoundryConfigurationError';
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

function chatCompletionsUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/u, '');
  if (normalized.endsWith('/openai/v1')) return `${normalized}/chat/completions`;
  if (normalized.endsWith('/openai')) return `${normalized}/v1/chat/completions`;
  return `${normalized}/openai/v1/chat/completions`;
}

class FoundryChatCompletionsGateway implements AzureFoundryGateway {
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}

  async generateContent(request: AzureFoundryGenerateRequest): Promise<string> {
    const response = await fetch(chatCompletionsUrl(this.endpoint), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });

    const payload = await response.json().catch(() => undefined) as ChatCompletionResponse | undefined;
    if (!response.ok) {
      const error = new Error(`Azure Foundry request failed with HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Azure Foundry 응답에 텍스트가 없습니다.');
    return text;
  }
}

export function createAzureFoundryGateway(): AzureFoundryGateway {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;

  if (!endpoint || !apiKey || !process.env.AZURE_FOUNDRY_MODEL) throw new AzureFoundryConfigurationError();

  return new FoundryChatCompletionsGateway(endpoint, apiKey);
}

export function getConfiguredModel(): string {
  const configuredModel = process.env.AZURE_FOUNDRY_MODEL;

  if (!configuredModel) throw new AzureFoundryConfigurationError();

  return configuredModel;
}
