import { GoogleGenAI } from '@google/genai';

export interface GeminiGenerateRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface GeminiGateway {
  generateContent(request: GeminiGenerateRequest): Promise<string>;
}

export class GeminiConfigurationError extends Error {
  constructor() {
    super('GEMINI_API_KEY가 설정되지 않았습니다.');
    this.name = 'GeminiConfigurationError';
  }
}

class GoogleGenAiGateway implements GeminiGateway {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateContent(request: GeminiGenerateRequest): Promise<string> {
    const response = await this.client.models.generateContent({
      model: request.model,
      contents: request.contents as never,
      config: request.config as never,
    });

    if (!response.text) {
      throw new Error('Gemini 응답에 텍스트가 없습니다.');
    }

    return response.text;
  }
}

export function createGeminiGateway(): GeminiGateway {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new GeminiConfigurationError();
  }

  return new GoogleGenAiGateway(apiKey);
}

export function getConfiguredModel(): string {
  const configuredModel = process.env.GEMINI_FLASH_MODEL;

  if (!configuredModel) {
    throw new Error('GEMINI_FLASH_MODEL이 설정되지 않았습니다.');
  }

  return configuredModel;
}

