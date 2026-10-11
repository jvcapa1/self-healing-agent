import { test, expect } from '../self-healing/fixture';

test('heals a broken selector with local strategies', async ({ selfHealingPage: page }) => {
  await page.goto('https://playwright.dev/');

  await page.locator('#nonexistent-get-started-button').click({ timeout: 1000 });

  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
