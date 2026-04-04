import { test, expect } from '../src/self-healing/fixture';

/**
 * This test uses a completely fabricated CSS selector whose words
 * ("homepage", "hero", "cta") share NO overlap with any visible text,
 * aria-label, or data attribute on https://playwright.dev/.
 *
 * • attribute-fallback: every extracted word is either a noise word
 *   (e.g. "data", "testid") or a word that matches zero / multiple
 *   elements (e.g. "homepage", "hero", "cta") — so it returns null.
 *
 * • fuzzy-match: token overlap with any DOM element is far below the
 *   0.45 threshold — so it also returns null.
 *
 * → The AI healer (layer 3) is the ONLY strategy that can resolve this
 *   selector by reading the simplified DOM, understanding the page URL,
 *   and inferring "homepage hero CTA" means the main "Get started" link.
 *
 * Requires a valid GITHUB_TOKEN in .env.
 */

test('AI healer: resolves a fabricated selector to the main CTA', async ({
  selfHealingPage: page,
}) => {
  await page.goto('https://playwright.dev/');

  // Completely fabricated — no element has this data-testid.
  // Only the AI layer can figure out the intent from DOM context.
  await page.locator('[data-testid="homepage-hero-cta"]').click();

  // If the AI correctly healed to the "Get started" link, we land on /docs/intro.
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
test('Test Github' , async ({ selfHealingPage: page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page.locator('[class="github"]')).toBeVisible();
});