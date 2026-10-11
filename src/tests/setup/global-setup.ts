import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { username, password, storageStatePath } from '../constrain/log-in';

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL :string = config.projects[0]?.use.baseURL as string;



  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(baseURL);
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.locator('.title').getByText('Products', { exact: true }).waitFor({ state: 'visible' });

    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: storageStatePath });
    await context.close();
  } finally {
    await browser.close();
  }
}

export default globalSetup;
