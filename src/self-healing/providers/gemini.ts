import { GoogleGenAI } from '@google/genai';

import type { AIOptions, AIProvider, SelfHealingConfig } from '../types';

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(config: SelfHealingConfig) {
    this.client = new GoogleGenAI({
      apiKey: config.geminiToken,
      httpOptions: {
        timeout: config.healingTimeoutMs,
        retryOptions: { attempts: 1 },
      },
    });
    this.defaultModel = config.aiModel;
  }

  async sendPrompt(systemPrompt: string, userPrompt: string, options?: AIOptions): Promise<string> {
    const response = await this.client.models.generateContent({
      model: options?.model ?? this.defaultModel,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: options?.maxTokens ?? 200,
        temperature: options?.temperature ?? 0,
      },
    });

    return response.text?.trim() ?? '';
  }
}
