import type { Page } from '@playwright/test';

import { selfHealingConfig } from '../config';
import type { HealingContext, HealingResult, HealingStrategy } from '../types';

const NOISE_WORDS = new Set([
  'page',
  'locator',
  'nonexistent',
  'missing',
  'broken',
  'element',
  'selector',
  'role',
  'name',
  'link',
  'button',
  'heading',
  'text',
  'input',
  'label',
  'navigation',
  'textbox',
  'checkbox',
  'radio',
  'getbyrole',
  'getbytext',
  'getbylabel',
  'getbyplaceholder',
  'getbytestid',
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
  'css',
  'xpath',
]);

interface CandidateElement {
  tag: string;
  role: string;
  text: string;
  id: string;
  className: string;
  ariaLabel: string;
  name: string;
  placeholder: string;
  href: string;
  dataTestId: string;
  dataTest: string;
  dataCy: string;
}

function tokenize(value: string): string[] {
  const raw = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token));

  // Also add digit-stripped variants (e.g. "ins3423tallation" → "installation")
  const extra: string[] = [];
  for (const token of raw) {
    const stripped = token.replace(/\d+/g, '');
    if (stripped.length > 1 && stripped !== token) {
      extra.push(stripped);
    }
  }

  return [...raw, ...extra];
}

function overlapScore(source: string[], target: string[]): number {
  if (source.length === 0 || target.length === 0) {
    return 0;
  }

  const sourceSet = new Set(source);
  let matches = 0;
  for (const token of target) {
    if (sourceSet.has(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(sourceSet.size, target.length);
}

function bestFieldScore(source: string[], candidate: CandidateElement): number {
  return Math.max(
    overlapScore(source, tokenize(candidate.text)),
    overlapScore(source, tokenize(candidate.ariaLabel)),
    overlapScore(source, tokenize(candidate.id)),
    overlapScore(source, tokenize(candidate.dataTestId)),
    overlapScore(source, tokenize(candidate.href)),
    overlapScore(source, tokenize(candidate.className)),
  );
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function guessSelectorFromCandidate(candidate: CandidateElement): string[] {
  const selectors: string[] = [];

  if (candidate.dataTestId) {
    selectors.push(`[data-testid="${escapeForDoubleQuotes(candidate.dataTestId)}"]`);
  }
  if (candidate.dataTest) {
    selectors.push(`[data-test="${escapeForDoubleQuotes(candidate.dataTest)}"]`);
  }
  if (candidate.dataCy) {
    selectors.push(`[data-cy="${escapeForDoubleQuotes(candidate.dataCy)}"]`);
  }
  if (candidate.role && candidate.text) {
    selectors.push(`role=${candidate.role}[name="${escapeForDoubleQuotes(candidate.text)}"]`);
  }
  if (candidate.role && candidate.ariaLabel) {
    selectors.push(`role=${candidate.role}[name="${escapeForDoubleQuotes(candidate.ariaLabel)}"]`);
  }
  if (candidate.ariaLabel) {
    selectors.push(`[aria-label="${escapeForDoubleQuotes(candidate.ariaLabel)}"]`);
  }
  if (candidate.id) {
    selectors.push(`#${candidate.id}`);
  }
  if (candidate.tag === 'a' && candidate.href) {
    selectors.push(`a[href="${escapeForDoubleQuotes(candidate.href)}"]`);
  }
  if (candidate.text) {
    selectors.push(`text=${escapeForDoubleQuotes(candidate.text)}`);
  }

  return selectors;
}

async function findUniqueSelector(page: Page, candidate: CandidateElement): Promise<string | null> {
  for (const selector of guessSelectorFromCandidate(candidate)) {
    try {
      if (await page.locator(selector).count() === 1) {
        return selector;
      }
    } catch {
      // Ignore invalid selectors.
    }
  }

  return null;
}

export class FuzzyMatchStrategy implements HealingStrategy {
  name = 'fuzzy-match';

  async heal(page: Page, selector: string, _context: HealingContext): Promise<HealingResult | null> {
    // Extract content-specific tokens: prefer the name/text inside structured selectors
    let selectorTokens = tokenize(selector);

    // For role=X[name="Y"] or text="Y", extract Y for better matching
    const nameMatch = selector.match(/\[name=["'](.+?)["']\]/) || selector.match(/text=["']?(.+?)["']?$/);
    if (nameMatch) {
      const contentTokens = tokenize(nameMatch[1]);
      if (contentTokens.length > 0) {
        selectorTokens = contentTokens;
      }
    }

    if (selectorTokens.length === 0) {
      return null;
    }

    const candidates = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('a,button,input,textarea,select,label,[role],[data-testid],[data-test],[data-cy]'),
      ).slice(0, 350);

      const inferRole = (element: Element): string => {
        const explicitRole = element.getAttribute('role');
        if (explicitRole) {
          return explicitRole;
        }

        const tag = element.tagName.toLowerCase();
        if (tag === 'a' && element.getAttribute('href')) {
          return 'link';
        }
        if (tag === 'button') {
          return 'button';
        }
        if (tag === 'input') {
          const type = (element.getAttribute('type') || 'text').toLowerCase();
          if (type === 'submit' || type === 'button') {
            return 'button';
          }
          if (type === 'checkbox') {
            return 'checkbox';
          }
          if (type === 'radio') {
            return 'radio';
          }
          return 'textbox';
        }
        if (tag === 'textarea') {
          return 'textbox';
        }
        return '';
      };

      return nodes.map((node) => {
        const element = node as HTMLElement;
        return {
          tag: element.tagName.toLowerCase(),
          role: inferRole(element),
          text: (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
          id: element.id || '',
          className: element.className || '',
          ariaLabel: element.getAttribute('aria-label') || '',
          name: element.getAttribute('name') || '',
          placeholder: element.getAttribute('placeholder') || '',
          href: element.getAttribute('href') || '',
          dataTestId: element.getAttribute('data-testid') || '',
          dataTest: element.getAttribute('data-test') || '',
          dataCy: element.getAttribute('data-cy') || '',
        };
      });
    });

    let best: { candidate: CandidateElement; score: number } | null = null;

    for (const candidate of candidates as CandidateElement[]) {
      const candidateTokens = tokenize(
        [
          candidate.text,
          candidate.id,
          candidate.className,
          candidate.ariaLabel,
          candidate.name,
          candidate.placeholder,
          candidate.href,
          candidate.dataTestId,
          candidate.dataTest,
          candidate.dataCy,
          candidate.role,
          candidate.tag,
        ].join(' '),
      );

      const score = Math.max(overlapScore(selectorTokens, candidateTokens), bestFieldScore(selectorTokens, candidate));
      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }

    if (!best || best.score < selfHealingConfig.fuzzyMatchThreshold) {
      return null;
    }

    const selectorGuess = await findUniqueSelector(page, best.candidate);
    if (!selectorGuess) {
      return null;
    }

    return {
      originalSelector: selector,
      healedSelector: selectorGuess,
      strategy: this.name,
      confidence: Math.min(0.95, best.score),
      timestamp: Date.now(),
    };
  }
}
