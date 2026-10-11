import { test, expect } from '../../self-healing/fixture';

test.describe('Login Page', () => {
  test('should display the login form', async ({ selfHealingPage: page }) => {
    await page.goto('/');
    await expect(page.locator(".login_logo")).toHaveText('Swag Labs');
    await page.getByRole('textbox', { name: 'Username' }).fill('standard_user');
    await page.getByRole('textbox', { name: 'Password' }).fill('secret_sauce');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator(".title")).toHaveText('Products');
  });

});
