import type { Page } from '@playwright/test';

import { extractSimplifiedDOM } from './dom-analyzer';
import { createAIProvider } from './providers/provider-factory';
import { selectorStore } from './selector-store';
import { AIHealerStrategy } from './strategies/ai-healer';
import { AttributeFallbackStrategy } from './strategies/attribute-fallback';
import { FuzzyMatchStrategy } from './strategies/fuzzy-match';
import { selfHealingConfig } from './config';
import type { HealingContext, HealingResult, HealingStrategy } from './types';

export class Healer {
  private readonly strategies: HealingStrategy[];

  constructor() {
    const hasProviderToken = selfHealingConfig.aiProvider === 'openai'
      ? selfHealingConfig.openAIToken
      : selfHealingConfig.aiProvider === 'nvidia'
        ? selfHealingConfig.nvidiaToken
        : selfHealingConfig.aiProvider === 'gemini'
          ? selfHealingConfig.geminiToken
          : selfHealingConfig.githubToken;
    if (!hasProviderToken) {
      const keyName = selfHealingConfig.aiProvider === 'gemini'
        ? 'GEMINI_API_KEY'
        : selfHealingConfig.aiProvider === 'openai'
          ? 'OPENAI_API_KEY'
          : selfHealingConfig.aiProvider === 'nvidia'
            ? 'NVIDIA_API_KEY'
            : 'GITHUB_TOKEN';
      console.warn(`[self-healing] ${selfHealingConfig.aiProvider} is disabled because ${keyName} is not set.`);
    }
    const provider = hasProviderToken ? createAIProvider() : null;
    this.strategies = [
      new AttributeFallbackStrategy(),
      new FuzzyMatchStrategy(),
      new AIHealerStrategy(provider),
    ];
  }

  async heal(page: Page, selector: string, context: HealingContext): Promise<HealingResult | null> {
    if (!selfHealingConfig.enabled) {
      return null;
    }

    const cached = selectorStore.get(selector, context.pageUrl);
    if (cached) {
      try {
        if ((await page.locator(cached.healedSelector).count()) === 1) {
          selectorStore.recordCacheHit(cached);
          return {
            originalSelector: cached.originalSelector,
            healedSelector: cached.healedSelector,
            strategy: 'cache',
            confidence: cached.confidence,
            timestamp: Date.now(),
          };
        }
      } catch {
        selectorStore.delete(selector, context.pageUrl);
      }
    }

    const enrichedContext: HealingContext = {
      ...context,
      domSnippet: context.domSnippet ?? (await extractSimplifiedDOM(page, selfHealingConfig.domMaxLength)),
    };

    for (const strategy of this.strategies) {
      try {
        const result = await strategy.heal(page, selector, enrichedContext);
        if (result) {
          selectorStore.set(result, context.pageUrl);
          selectorStore.recordHeal(result);
          return result;
        }
      } catch {
        // Keep trying the remaining strategies.
      }
    }

    selectorStore.recordFailure(selector, context.pageUrl, context.errorMessage);
    return null;
  }
}
