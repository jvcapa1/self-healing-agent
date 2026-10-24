import { Page, Locator } from "@playwright/test";

export class LogInPage {
    logInTextBox: Locator
    passWordTextBox: Locator
    logInPageButton: Locator
    productsHeader: Locator
    constructor(private page: Page) {
        this.logInTextBox = page.getByRole('textbox', { name: 'Username' });
        this.passWordTextBox = page.getByRole('textbox', { name: 'Password' });
        this.logInPageButton = page.getByRole('button', { name: 'Login' });
        this.productsHeader = page.locator('.title').getByText('Products', { exact: true });
    }
    async fillLogInForm(username: string, password: string) {
        await this.logInTextBox.fill(username);
        await this.passWordTextBox.fill(password);
        await this.logInPageButton.click();
        await this.productsHeader.waitFor({ state: 'visible' });
    }

}