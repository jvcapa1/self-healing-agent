import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { username, password, storageStatePath } from '../constrain/log-in';
import {LogInPage} from '../../pages/log-in-page';  

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('\x1b[1;32mLogging in Global Set up\x1b[0m');

  const baseURL :string = config.projects[0]?.use.baseURL as string;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const logInPage = new LogInPage(page);

    await page.goto(baseURL);
    await logInPage.fillLogInForm(username, password);
    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: storageStatePath });
    await context.close();
  }
  catch (error) {
    console.error('Error during global setup:', error);
  } 
  finally {
    await browser.close();
    console.log('\x1b[1;32mGlobal Setup Completed\x1b[0m');
  }
}

export default globalSetup;
