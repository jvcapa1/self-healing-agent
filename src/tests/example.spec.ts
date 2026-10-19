import { test, expect } from '../fixtures';

test.describe('Home Page Validation', () => {
  test('Validate Home Page Header and list', async ({ selfHealingPage: page }) => {
    await page.goto('/inventory.html');
    await expect(page.locator(".title")).toHaveText('Products');
    await expect(page.locator('.inventory_list')).toBeVisible();
  });
  test("Validate 6 products are displayed on the home page", async ({ selfHealingPage: page }) => {
    await page.goto('/inventory.html');
    const products = await page.locator('.inventory_item');
    await expect(page.locator(".title")).toHaveText('Products');

    console.log("Products count: ", await products.count());
    const productCount = await products.count();
    expect(productCount).toBe(6);
  })
  test("Click All Add to Cart buttons and validate cart count", async ({ selfHealingPage: page }) => {
    await page.goto('/inventory.html');
    await expect(page.locator(".title")).toHaveText('Products');

    const addToCartButtons = await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]');
    await expect(addToCartButtons).toBeVisible();
    const cartCountLocator = await page.locator('[data-test="shopping-cart-link"]');
    await expect(cartCountLocator).toBeVisible();
    for (let i = 0; i < await addToCartButtons.count(); i++) {
      await addToCartButtons.nth(i).click();
      const expectedCount = (i + 1).toString();
      await expect(cartCountLocator).toHaveText(expectedCount);
    }
  });
});
