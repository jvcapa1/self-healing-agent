import type { Page } from '@playwright/test';

import { selfHealingConfig } from '../config';
import { extractElementContext } from '../dom-analyzer';
import type { AIProvider, HealingContext, HealingResult, HealingStrategy } from '../types';

function sanitizeAiResponse(value: string): string {
  const trimmed = value.trim();
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const withoutFences = firstLine.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
  const locatorMatch = withoutFences.match(/(?:page\.)?locator\((['"`])(.+?)\1\)/);
  if (locatorMatch) {
    return locatorMatch[2].trim();
  }
  return withoutFences.replace(/^['"`]|['"`]$/g, '').trim();
}

export class AIHealerStrategy implements HealingStrategy {
  name = 'ai-healer';
  private aiHealsThisRun = 0;

  constructor(private readonly provider: AIProvider | null) {}

  async heal(page: Page, selector: string, context: HealingContext): Promise<HealingResult | null> {
   console.log(`[ai-healer] Attempting to heal selector: ${selector} on page: ${context.pageUrl}`);
    if (!selfHealingConfig.enabled) {
      return null;
    }

    if (process.env.CI && !selfHealingConfig.enableInCI) {
      return null;
    }

    if (!this.provider) {
      return null;
    }

    if (this.aiHealsThisRun >= selfHealingConfig.maxAIHealsPerRun) {
      return null;
    }

    const domSnippet = context.domSnippet ?? (await extractElementContext(page, selector, selfHealingConfig.domMaxLength));

    const systemPrompt =
      'You are a Playwright selector repair expert. Return exactly one Playwright selector string that can be passed directly to page.locator(...). For role selectors, always use case-insensitive regex for the name, e.g. role=link[name=/get started/i]. For text selectors use text=/some text/i. Return only the selector string with no markdown and no explanation.';
    const userPrompt = [
      `Page URL: ${context.pageUrl}`,
      `Action: ${context.action}`,
      `Failed selector: ${selector}`,
      `Error message: ${context.errorMessage}`,
      'DOM snippet:',
      domSnippet,
    ].join('\n\n');

    try {
      const rawSelector = await this.provider.sendPrompt(systemPrompt, userPrompt, {
        model: selfHealingConfig.aiModel,
        maxTokens: 2000,
        temperature: 0,
      });
      const healedSelector = sanitizeAiResponse(rawSelector);

      if (!healedSelector) {
        return null;
      }

      // Try the selector as-is first
      let finalSelector = healedSelector;
      let count = await page.locator(finalSelector).count();

      // If no match, try converting exact name to case-insensitive regex
      // e.g. role=link[name="GET STARTED"] → role=link[name=/GET STARTED/i]
      if (count !== 1) {
        const nameExact = healedSelector.match(/^(role=\w+\[name=)"(.+?)"\]$/);
        if (nameExact) {
          const escaped = nameExact[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          finalSelector = `${nameExact[1]}/${escaped}/i]`;
          count = await page.locator(finalSelector).count();
        }
      }

      if (count !== 1) {
        return null;
      }

      this.aiHealsThisRun += 1;
      return {
        originalSelector: selector,
        healedSelector: finalSelector,
        strategy: this.name,
        confidence: 0.92,
        model: selfHealingConfig.aiModel,
        timestamp: Date.now(),
      };
    } catch (err) {
      const error = err as Error & { cause?: unknown };
      const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
      console.error(`[ai-healer] ${this.provider.name} API error:`, `${error.message?.slice(0, 400) ?? String(err)}${cause}`);
      return null;
    }
  }
}
