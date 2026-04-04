import OpenAI from 'openai';

import type { AIOptions, AIProvider, SelfHealingConfig } from '../types';

export class GitHubModelsProvider implements AIProvider {
  name = 'github-models';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: SelfHealingConfig) {
    this.client = new OpenAI({
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: config.githubToken,
    });
    this.defaultModel = config.aiModel;
  }

  async sendPrompt(systemPrompt: string, userPrompt: string, options?: AIOptions): Promise<string> {
    const model = options?.model ?? this.defaultModel;
    const isReasoningModel = /^(o[1-9]|gpt-5)/.test(model);

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    if (isReasoningModel) {
      // Reasoning models use max_completion_tokens and don't support temperature
      params.max_completion_tokens = options?.maxTokens ?? 2000;
    } else {
      params.max_tokens = options?.maxTokens ?? 200;
      params.temperature = options?.temperature ?? 0;
    }

    const response = await this.client.chat.completions.create(params);
    return response.choices[0]?.message?.content?.trim() ?? '';
  }
}
