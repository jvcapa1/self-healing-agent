import type { Locator, Page } from "@playwright/test";

export class HomePage {
  readonly productsHeader: Locator;
  readonly inventoryList: Locator;
  readonly products: Locator;
  readonly addToCartBackpackButton: Locator;
  readonly shoppingCartLink: Locator;

  constructor(page: Page) {
    this.productsHeader = page.locator('[data-test="title"]');
    this.inventoryList = page.locator(".inventory_list");
    this.products = page.locator(".inventory_item");
    this.addToCartBackpackButton = page.locator('[data-test="add-to-cart-sauce-labs-backpack"]');
    this.shoppingCartLink = page.locator('[data-test="shopping-cart-link"]');
  }
}
