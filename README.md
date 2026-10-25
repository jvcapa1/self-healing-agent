# Self-Healing Playwright Agent

A TypeScript and Playwright example project that attempts to recover from broken UI locators during tests, records how each locator was repaired, and produces a post-run test analysis report.

## How it works

The project has two separate agents:

1. **Self-healing locator** runs during a test when a locator action or supported assertion fails with a recoverable selector error.
2. **Test execution agent** runs at the end of the Playwright suite, summarizes outcomes, optionally requests a failure analysis from Gemini, and creates a PDF report.

Neither agent changes the application or rewrites test source files. Healing retries the failing operation with a replacement locator; the reports provide evidence and recommendations for developers to review.

### Self-healing locator

Tests that want healing use the `selfHealingPage` fixture and the fixture's `expect` export. The fixture wraps page locator queries and locator actions such as `click`, `fill`, and `hover`. It also wraps supported locator assertions, including `toBeVisible` and `toHaveText`.

When a supported operation fails because the selector cannot find a usable element, the `Healer` tries these steps in order:

1. **Cache** — Reuse a previous repair for the same page URL and original selector, provided it still resolves to exactly one element.
2. **Attribute fallback** — Derive likely text, role, and attribute selectors from hints in the broken locator.
3. **Fuzzy match** — Compare words from the locator with interactive elements' text and attributes, then accept a unique selector if its score meets the configured threshold.
4. **AI healer** — If the earlier strategies do not find a unique match, send the page URL, failed locator, action/error context, and a bounded DOM snapshot to the configured AI provider. The suggested selector must resolve to exactly one element before it is used.

If a strategy returns a valid repair, the fixture retries the original action or assertion using the repaired selector. If no repair is found, the original Playwright error is rethrown. Healing is a best-effort recovery mechanism: it cannot determine every test's intent, so a passing test after healing should still be reviewed.

The cache and JSON healing report are written under `self-healing-report/`. The Playwright healing reporter prints a summary and the repaired selectors at the end of the run.

### Test execution agent

`src/agents/test-execution-agent.ts` is registered as a Playwright reporter. It collects each test's final result, marks a test that passed after a retry as flaky, and reads the self-healing JSON report. It then:

- Produces a local summary of failures, flaky tests, and healing attempts.
- When `GEMINI_API_KEY` is configured and there are failed/flaky tests or healed selectors, asks Gemini to classify root causes, review whether healing appears safe, and suggest a fix. The analysis is advisory; it does not edit tests or apply fixes.
- Generates `playwright-report/test-analysis.pdf` with test outcomes and healing details.
- Opens the PDF automatically after a local run by default. Set `TEST_ANALYSIS_OPEN=false` to disable this, or `true` to request opening it.

Without `GEMINI_API_KEY`, the PDF still includes the local test summary; the AI verdict section is skipped.

## Requirements

- Node.js (an active LTS version is recommended)
- npm
- A Playwright-supported browser (Chromium is configured)
- SauceDemo test credentials for the configured global login setup

## Install and configure

```powershell
npm install
npx playwright install chromium
```

Create a local `.env` file in the repository root. Do not commit this file; it is ignored by Git.

```env
SAUCEDEMO_USERNAME=your-saucedemo-username
SAUCEDEMO_PASSWORD=your-saucedemo-password

# Optional: configure AI-assisted locator repair.
# AI_PROVIDER=gemini
# GEMINI_API_KEY=your-gemini-api-key
# AI_MODEL=gemini-3.5-flash-lite
```

The global Playwright setup logs in to SauceDemo and saves browser state to `playwright/.auth/saucedemo.json` before tests run. The current configuration uses `https://www.saucedemo.com` as its base URL.

AI repair is optional. Attribute fallback and fuzzy matching can run without an AI key. Supported providers are `github-models`, `openai`, `nvidia`, and `gemini`; set `AI_PROVIDER` and the corresponding credential:

| Provider | Credential |
| --- | --- |
| `github-models` (default) | `GITHUB_TOKEN` |
| `openai` | `OPENAI_API_KEY` |
| `nvidia` | `NVIDIA_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |

`AI_MODEL` overrides the selected provider's default model. The test-execution agent's optional post-run AI analysis specifically uses `GEMINI_API_KEY` and `GEMINI_MODEL`; configuring another provider for locator repair does not configure that analysis.

### Explore a website with Gemini and Playwright MCP

The exploratory script starts the local Playwright MCP server in headless mode and gives its browser tools to Gemini. Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in `.env`, then run:

```powershell
npm run explore -- https://example.com "Explore the main navigation and search flow"
```

The optional task defaults to a summary of the main page. The script prints Gemini's findings, allows credentials explicitly included in the task to be used for sign-in, and instructs it to avoid actions that change site data. Credentials are excluded from the report.

After each completed exploration, the script also generates an A4 PDF report at `playwright-report/explore-agent-run-report.pdf`, using the saved findings and a timestamp.
Gemini 429 responses are retried up to 10 times. Server-requested waits are capped at one minute per attempt (plus a one-second buffer), so a daily-quota error retries for a bounded period and then fails if the quota is still exhausted.

The GitHub Actions workflow runs this exploration in a separate `explore-test` job on pushes to `main` or `master`. It uploads the generated PDF as the `explore-agent-run-report` workflow artifact. Configure the repository's `GEMINI_API_KEY` Actions secret to enable the job.

## Run tests and reports

```powershell
# Run the configured test suite
npm test

# Run with a visible browser
npm run test:headed

# Print the most recent self-healing JSON report, if one exists
npm run test:heal-report
```

Playwright is configured to discover tests under `src/tests`. The sample test imports the merged Playwright/self-healing fixture from `src/fixtures/index.ts`:

```ts
import { test, expect } from '../fixtures';

test('check the products page', async ({ selfHealingPage: page }) => {
  await page.goto('/inventory.html');
  await expect(page.locator('.title')).toHaveText('Products');
});
```

Generated outputs include:

- `playwright-report/` — Playwright's HTML report and the test execution agent's `test-analysis.pdf`
- `self-healing-report/.self-healing-cache.json` — cached selector repairs
- `self-healing-report/.self-healing-report.json` — healing attempts and failures

### Test analysis PDF sample

After `npm test` finishes locally, the test execution agent writes its PDF here:

[Open the generated test analysis PDF](./playwright-report/test-analysis.pdf)

The PDF is generated at runtime and is not committed to the repository. In CI, the GitHub Actions workflow uploads the `playwright-report/` directory as an artifact named `playwright-report` (retained for 30 days). Open the completed workflow run on GitHub and download that artifact to view the PDF alongside the Playwright report.

These generated directories, local credentials, and browser auth state are excluded from version control.

## Configuration

Self-healing settings can be supplied in `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SELF_HEALING_ENABLED` | `true` | Enable or disable locator healing |
| `SELF_HEALING_ENABLE_IN_CI` | `false` | Permit AI locator healing in CI; heuristic strategies remain available |
| `AI_PROVIDER` | `github-models` (or `openai` when `OPENAI_API_KEY` is set and no provider is specified) | AI provider for locator repair |
| `AI_MODEL` | Provider-dependent | Model used for locator repair |
| `MAX_AI_HEALS_PER_RUN` | `5` | Maximum successful AI locator repairs per healer instance |
| `SELF_HEALING_TIMEOUT_MS` | `15000` | Configured healing timeout |
| `FUZZY_MATCH_THRESHOLD` | `0.45` | Minimum fuzzy-match score |
| `DOM_MAX_LENGTH` | `4000` | Maximum DOM snapshot characters sent to the AI healer |
| `TEST_ANALYSIS_OPEN` | Opens locally by default; disabled in CI | Whether to open the generated analysis PDF |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Model for the test execution agent's Gemini analysis |

The Playwright configuration sets the locator action timeout to five seconds and enables two CI retries. CI healing is disabled by default by `SELF_HEALING_ENABLE_IN_CI`, but the repository's GitHub Actions workflow explicitly enables it.

## Project layout

```text
src/
  agents/
    test-execution-agent.ts   # End-of-run analysis and PDF reporter
  fixtures/
    index.ts                  # Combines Playwright and self-healing fixtures
  tests/
    example.spec.ts           # Sample SauceDemo browser tests
    setup/                    # Authentication setup and teardown
self-healing/
  fixture.ts                  # Healing-aware Page and expect wrappers
  healer.ts                   # Cache and strategy orchestration
  config.ts                   # Environment-based configuration
  dom-analyzer.ts             # Bounded DOM snapshot extraction
  selector-store.ts           # Persistent cache and healing report
  reporter.ts                 # Healing summary reporter
  strategies/                 # Attribute, fuzzy, and AI strategies
  providers/                  # Provider implementations and factory
playwright.config.ts           # Playwright projects, reporters, and setup
```
