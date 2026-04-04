import { selfHealingConfig } from '../config';
import type { AIProvider } from '../types';
import { GitHubModelsProvider } from './github-models';

export function createAIProvider(): AIProvider {
  switch (selfHealingConfig.aiProvider) {
    case 'github-models':
    default:
      return new GitHubModelsProvider(selfHealingConfig);
  }
}
