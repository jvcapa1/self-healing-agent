import { test, expect } from '../self-healing/fixture';

test('self-healing sample: broken selector is repaired automatically', async ({ selfHealingPage: page }) => {
  await page.goto('https://playwright.dev/');

  // Deliberately broken selector to trigger self-healing.
  await page.locator('#nonexistent-get-started-button').click({ timeout: 1000 });

  await expect(page.getByRole('link', { name: /get started/i })).toBeVisible();
});
