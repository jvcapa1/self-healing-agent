import { selfHealingConfig } from '../config';
import type { AIProvider } from '../types';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';

export function createAIProvider(): AIProvider {
  switch (selfHealingConfig.aiProvider) {
    case 'openai':
    case 'github-models':
    case 'nvidia':
      return new OpenAIProvider(selfHealingConfig);
    case 'gemini':
      return new GeminiProvider(selfHealingConfig);
    default:
      return new OpenAIProvider(selfHealingConfig);
  }
}
