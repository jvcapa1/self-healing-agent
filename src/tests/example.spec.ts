import { test, expect } from '../fixtures/index';

test.describe('Home Page Validation', () => {
  test('Validate Home Page Header and list', async ({ selfHealingPage: page, homePage }) => {
    await page.goto('/inventory.html');
    await expect(homePage.productsHeader).toHaveText('Products');
    await expect(homePage.inventoryList).toBeVisible();
  });
  test("Validate 6 products are displayed on the home page", async ({ selfHealingPage: page, homePage }) => {
    await page.goto('/inventory.html');
    await expect(homePage.productsHeader).toHaveText('Products');

    const productCount = await homePage.products.count();
    expect(productCount).toBe(6);
  })
  test("Click All Add to Cart buttons and validate cart count", async ({ selfHealingPage: page, homePage }) => {
    await page.goto('/inventory.html');
    await expect(homePage.productsHeader).toHaveText('Products');

    await expect(homePage.addToCartBackpackButton).toBeVisible();
    await expect(homePage.shoppingCartLink).toBeVisible();
    for (let i = 0; i < await homePage.addToCartBackpackButton.count(); i++) {
      await homePage.addToCartBackpackButton.nth(i).click();
      const expectedCount = (i + 1).toString();
      await expect(homePage.shoppingCartLink).toHaveText(expectedCount);
    }
  });
});
