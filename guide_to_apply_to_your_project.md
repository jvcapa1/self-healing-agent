# Guide to apply this self-healing Playwright setup to your project

This guide explains the most practical ways to reuse this project in another project.

## Recommended approach

Use one of these two methods:

1. Git clone the project and copy the healing code into your repo
2. Copy the `self-healing/` folder and the fixture import into your existing project

I recommend starting with method 2 if you already have a project and want the fastest adoption.

---

## Method 1: Using git clone

### Step 1: Clone the project

```bash
git clone https://github.com/your-user/self-healing-agent.git
cd self-healing-agent
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Add your environment variables

Create a `.env` file from the project pattern:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
GITHUB_TOKEN=your_token_here
MAX_AI_HEALS_PER_RUN=5
SELF_HEALING_ENABLED=true
SELF_HEALING_ENABLE_IN_CI=false
SELF_HEALING_TIMEOUT_MS=15000
FUZZY_MATCH_THRESHOLD=0.45
DOM_MAX_LENGTH=4000
```

If you use OpenAI or Gemini instead, replace the token and provider accordingly.

### Step 4: Run the sample

```bash
npx playwright test tests/self-healing-sample.spec.ts --reporter=list
```

### Step 5: Copy the self-healing folder into your app

Once it works in this repo, copy these files into your target project:

- `self-healing/`
- `tests/self-healing-sample.spec.ts`
- `.env` settings
- `playwright.config.ts` reporter configuration

### Step 6: Update imports in your tests

Use:

```ts
import { test, expect } from '../self-healing/fixture';
```

or the correct relative path in your project structure.

---

## Method 2: Copy-paste into your existing project

This is the simplest option if your repo already has Playwright tests.

### Step 1: Copy the folder

Copy the whole `self-healing/` folder into the root of your existing project.

Example structure:

```text
my-project/
  self-healing/
    config.ts
    fixture.ts
    healer.ts
    dom-analyzer.ts
    selector-store.ts
    reporter.ts
    strategies/
    providers/
  tests/
    example.spec.ts
```

### Step 2: Install the dependencies

From your project root, install the packages used by the self-healing code:

```bash
npm install @playwright/test playwright dotenv @google/genai openai
```

### Step 3: Add the config file values

Add these values to your `.env`:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
MAX_AI_HEALS_PER_RUN=1
SELF_HEALING_ENABLED=true
SELF_HEALING_ENABLE_IN_CI=false
SELF_HEALING_TIMEOUT_MS=15000
FUZZY_MATCH_THRESHOLD=0.45
DOM_MAX_LENGTH=4000
# GEMINI_API_KEY=your_gemini_api_key_here
```

### Step 4: Update the reporter in Playwright config

In `playwright.config.ts`:

```ts
reporter: [
  ['html', { open: 'never' }],
  ['./self-healing/reporter.ts'],
  ['list'],
],
use: {
  actionTimeout: 5000,
},
```

### Step 5: Import the healing fixture in your test

```ts
import { test, expect } from '../self-healing/fixture';
```

### Step 6: Add one sample broken selector test

```ts
import { test, expect } from '../self-healing/fixture';

test('broken selector heals automatically', async ({ selfHealingPage: page }) => {
  await page.goto('https://playwright.dev/');
  await page.locator('#missing-button').click({ timeout: 1000 });
  await expect(page.getByRole('link', { name: /get started/i })).toBeVisible();
});
```

### Step 7: Run the tests

```bash
npx playwright test --reporter=list
```

---

## Best-practice structure for a new project

I recommend this structure:

```text
project-root/
  self-healing/
  tests/
  playwright.config.ts
  .env
  package.json
```

This keeps the healing logic separate from app code and makes it easier to reuse in future projects.

---

## Optional additional methods I recommend later

These are useful if you want a cleaner reuse flow:

1. Template repo
   - publish this as a reusable starter repo
   - copy with `git clone` or use as a template on GitHub

2. NPM package
   - package the healer as an internal package
   - install it in multiple projects

3. Git submodule
   - keep the healing library in a separate repo and attach it to your project

4. Copy-only internal template
   - keep a `templates/playwright-self-healing` folder in your company repo
   - copy it into each new project

---

## My recommendation for you

If you are applying this manually right now, do this:

- use the copy-paste method for immediate adoption
- use git clone when you want to keep the project as a reusable base

This gives you the fastest integration with the least friction.

---

## Quick summary

- fastest method: copy-paste the `self-healing/` folder
- best reusable method: `git clone` and keep it as a template repo
- safest long-term pattern: store self-healing as a standalone template or package
