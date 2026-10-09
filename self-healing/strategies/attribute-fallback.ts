import type { Page } from '@playwright/test';

import type { HealingContext, HealingResult, HealingStrategy } from '../types';

const NOISE_WORDS = new Set([
  'page',
  'locator',
  'getbyrole',
  'getbytext',
  'getbylabel',
  'getbyplaceholder',
  'getbytestid',
  'nonexistent',
  'missing',
  'broken',
  'button',
  'link',
  'input',
  'field',
  'label',
  'role',
  'name',
  'heading',
  'text',
  'navigation',
  'textbox',
  'checkbox',
  'radio',
  'data',
  'testid',
  'test',
  'qa',
  'cy',
  'id',
  'automation',
  'purpose',
  'target',
  'action',
  'section',
  'selector',
  'css',
  'xpath',
]);

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeHint(value: string): string {
  return value
    .replace(/page\.|locator\(|\)|[#[\].:=><]/g, ' ')
    .replace(/['"`]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseHint(value: string): string {
  const tokens = normalizeHint(value)
    .split(' ')
    .filter((token) => token && !NOISE_WORDS.has(token.toLowerCase()));
  return tokens.join(' ').trim();
}

function extractHints(selector: string): string[] {
  const hints = new Set<string>();
  const normalized = normalizeHint(selector);
  const collapsed = collapseHint(selector);

  if (normalized) {
    hints.add(normalized);
  }
  if (collapsed) {
    hints.add(collapsed);
  }

  for (const match of selector.matchAll(/['"]([^'"]{2,80})['"]/g)) {
    hints.add(normalizeHint(match[1]));
    const collapsedMatch = collapseHint(match[1]);
    if (collapsedMatch) {
      hints.add(collapsedMatch);
    }
  }

  const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch) {
    hints.add(normalizeHint(idMatch[1]));
    const collapsedId = collapseHint(idMatch[1]);
    if (collapsedId) {
      hints.add(collapsedId);
    }
  }

  return [...hints].filter((hint) => hint.length >= 3);
}

async function firstUniqueCandidate(page: Page, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if (!candidate) {
        continue;
      }

      const count = await page.locator(candidate).count();
      if (count === 1) {
        return candidate;
      }
    } catch {
      // Ignore invalid selectors and keep searching.
    }
  }

  return null;
}

export class AttributeFallbackStrategy implements HealingStrategy {
  name = 'attribute-fallback';

  async heal(page: Page, selector: string, _context: HealingContext): Promise<HealingResult | null> {
    const hints = extractHints(selector);

    // Try full hints first (exact matches)
    for (const hint of hints) {
      const escaped = escapeForDoubleQuotes(hint);
      const compact = hint.toLowerCase().replace(/\s+/g, '-');
      const candidate = await firstUniqueCandidate(page, [
        `role=link[name="${escaped}"]`,
        `role=button[name="${escaped}"]`,
        `text=${escaped}`,
        `[aria-label*="${escaped}" i]`,
        `[placeholder*="${escaped}" i]`,
        `[name*="${escaped}" i]`,
        `[data-testid*="${compact}" i]`,
        `[data-test*="${compact}" i]`,
        `[data-cy*="${compact}" i]`,
      ]);

      if (candidate) {
        return {
          originalSelector: selector,
          healedSelector: candidate,
          strategy: this.name,
          confidence: 0.88,
          timestamp: Date.now(),
        };
      }
    }

    // Try partial word matches from role selectors — e.g. role=link[name="Get3423 started"]
    // extracts individual words and tries regex-based partial matches
    const roleMatch = selector.match(/role=(\w+)\[name="(.+?)"\]/);
    const role = roleMatch?.[1];
    const nameFromRole = roleMatch?.[2];

    const allWords = new Set<string>();
    for (const hint of hints) {
      for (const word of hint.split(/\s+/)) {
        if (word.length >= 3 && !NOISE_WORDS.has(word.toLowerCase())) {
          allWords.add(word);
          // Also try stripping digits (e.g. "Ins3423tallation" → "Installation")
          const stripped = word.replace(/\d+/g, '');
          if (stripped.length >= 3 && stripped !== word) {
            allWords.add(stripped);
          }
        }
      }
    }
    if (nameFromRole) {
      for (const word of nameFromRole.split(/\s+/)) {
        if (word.length >= 3 && !NOISE_WORDS.has(word.toLowerCase())) {
          allWords.add(word);
          const stripped = word.replace(/\d+/g, '');
          if (stripped.length >= 3 && stripped !== word) {
            allWords.add(stripped);
          }
        }
      }
    }

    for (const word of allWords) {
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const partialCandidates: string[] = [];

      if (role) {
        partialCandidates.push(`role=${role}[name=/${escapedWord}/i]`);
      }
      partialCandidates.push(
        `role=link[name=/${escapedWord}/i]`,
        `role=button[name=/${escapedWord}/i]`,
        `role=heading[name=/${escapedWord}/i]`,
        `text=/${escapedWord}/i`,
      );

      const candidate = await firstUniqueCandidate(page, partialCandidates);
      if (candidate) {
        return {
          originalSelector: selector,
          healedSelector: candidate,
          strategy: this.name,
          confidence: 0.75,
          timestamp: Date.now(),
        };
      }
    }

    return null;
  }
}
