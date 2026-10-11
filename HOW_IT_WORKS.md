# Self-Healing Playwright Agent — How It Works

When a Playwright locator fails (element not found, timeout), the self-healing system automatically tries to find the correct element using three escalating strategies, then re-runs the action with the healed selector — all without changing your test code.

---

## Architecture Overview

```
Test Code
   │
   ▼
selfHealingPage fixture          ← wraps every locator method + expect assertions
   │
   ▼  (on failure)
Healer
   ├── 1. Cache lookup           ← instant — reuses a previously healed selector
   ├── 2. Attribute Fallback     ← fast — tries text/role/aria variations
   ├── 3. Fuzzy Match            ← moderate — scores DOM candidates by token overlap
   └── 4. AI Healer              ← slow but powerful — sends DOM to GitHub Models AI
         │
         ▼
   Selector Store                ← caches healed result to disk (JSON)
   Reporter                      ← logs summary + writes JSON report
```

---

## The Three Healing Strategies

### Layer 1 — Attribute Fallback (`attribute-fallback.ts`)

The fastest layer. It extracts words from the broken selector and constructs common Playwright selector patterns to try:

- Exact role matches: `role=link[name="Get started"]`
- Text matches: `text=Get started`
- Attribute matches: `[aria-label*="..."]`, `[data-testid*="..."]`
- Partial word matches with regex: `role=link[name=/started/i]`
- Digit-stripped variants: `"Ins3423tallation"` → tries `"Installation"`

**Example:** `role=link[name="Get_started_3124"]` → heals to `text=GET STARTED`

---

### Layer 2 — Fuzzy Match (`fuzzy-match.ts`)

If layer 1 finds nothing, this layer queries all interactive DOM elements (`a`, `button`, `input`, `[role]`, `[data-testid]`, etc.) and scores each one by measuring token overlap between the broken selector's content words and each element's visible text, aria-label, id, and data attributes.

Key behaviours:
- Structural words (`role`, `name`, `link`, `button`, `testid`, etc.) are filtered as noise before scoring
- Digit-stripped token variants are added to the scoring set (e.g. `ins3423tallation` → also tries `installation`)
- A match is accepted if the best score exceeds the threshold (default: `0.45`)

**Example:** `role=heading[name="Ins3423tallation"]` → token `installation` scores 1.0 against the `<h1>Installation</h1>` heading

---

### Layer 3 — AI Healer (`ai-healer.ts`)

The last resort. When layers 1 and 2 find no match (e.g. the selector name has zero overlap with any page content), the AI healer:

1. Extracts a simplified DOM snapshot of the page
2. Sends a prompt to **GitHub Models API** (`gpt-4o-mini` by default) with:
   - The page URL
   - The failed selector
   - The error message
   - The DOM snippet
3. Parses the AI's response and validates it finds exactly 1 element on the page
4. Falls back to a case-insensitive regex variant if the exact AI suggestion matches 0 elements

**Example:** `[data-testid="homepage-hero-cta"]` → AI reads the DOM, infers it's the main CTA, returns `role=link[name=/get started/i]`

---

## Cache & Persistence

Every healed selector is saved to `sel-healing-report/.self-healing-cache.json`. On subsequent runs, the cache is checked first — so a healed selector is reused instantly without re-running any strategy.

The cache entry is invalidated automatically if the healed selector no longer finds exactly 1 element on the page (element was removed or re-named again).

---

## Reporting

After every test run, `[self-healing] Summary` is printed to the console:

```
[self-healing] Summary
[self-healing] Healed: 3 | From cache: 1 | Failed: 0
[self-healing] role=link[name="Get_started_3124"]  -> text=GET STARTED  (fuzzy-match)
[self-healing] [data-testid="homepage-hero-cta"]   -> role=link[name=/get started/i]  (ai-healer:gpt-4o-mini)
[self-healing] #nonexistent-get-started-button     -> text=get started  (attribute-fallback)
```

A detailed JSON report is also written to `sel-healing-report/.self-healing-report.json` with timestamps, confidence scores, suggested code fixes, and any failures.

---

## How the Fixture Works

The fixture (`fixture.ts`) is what makes healing transparent — your test code never changes.

It wraps the Playwright `Page` object in two ways:

**1. Locator method patching** — methods like `.click()`, `.fill()`, `.hover()` are patched on every `Locator` object. When one throws a timeout or "element not found" error, the healer is invoked with the broken selector, and the action is retried with the healed one.

**2. Healing-aware `expect`** — `expect(locator).toBeVisible()` and similar assertion methods are intercepted via a Proxy. If the assertion fails, the healer is invoked on the locator's selector and the assertion is retried.

---

## File Structure

```
self-healing/
├── fixture.ts             ← Playwright fixture + expect wrapper (entry point for tests)
├── healer.ts              ← Orchestrates all strategies in order
├── config.ts              ← Reads env vars (GITHUB_TOKEN, AI_MODEL, thresholds…)
├── types.ts               ← Shared TypeScript interfaces
├── dom-analyzer.ts        ← Extracts simplified DOM snapshots for AI
├── selector-store.ts      ← JSON cache + healing report
├── reporter.ts            ← Custom Playwright reporter (console + JSON)
├── strategies/
│   ├── attribute-fallback.ts   ← Layer 1: word/role/text/regex attempts
│   ├── fuzzy-match.ts          ← Layer 2: token overlap scoring
│   └── ai-healer.ts            ← Layer 3: GitHub Models AI
└── providers/
    ├── openai.ts               ← OpenAI-compatible provider for GitHub Models/OpenAI
    ├── gemini.ts               ← Gemini provider
    └── provider-factory.ts     ← Returns the configured provider instance

tests-sample/
├── example.spec.ts             ← Tests with intentionally broken selectors
├── demo-healing.spec.ts        ← Demos attribute-fallback healing
└── demo-ai-healing.spec.ts     ← Demos AI healer (fabricated data-testid)

sel-healing-report/             ← Generated at runtime (git-ignored)
├── .self-healing-cache.json
└── .self-healing-report.json
```

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | API key for Gemini (when `AI_PROVIDER=gemini`) |
| `OPENAI_API_KEY` | — | API key for OpenAI (when `AI_PROVIDER=openai`) |
| `AI_MODEL` | `gpt-4o-mini` (`gemini-3.5-flash-lite` for Gemini) | Model name for the selected provider |
| `AI_PROVIDER` | `github-models` | Provider: `github-models`, `openai`, or `gemini` |
| `MAX_AI_HEALS_PER_RUN` | `5` | Safety cap on AI calls per test run |
| `SELF_HEALING_ENABLED` | `true` | Master switch |
| `SELF_HEALING_ENABLE_IN_CI` | `false` | Allow healing on CI (disabled by default) |
| `FUZZY_MATCH_THRESHOLD` | `0.45` | Minimum overlap score to accept a fuzzy match (0–1) |
| `DOM_MAX_LENGTH` | `4000` | Max characters of DOM sent to the AI |
| `SELF_HEALING_TIMEOUT_MS` | `15000` | Timeout for the healing attempt |

---

## Running the Tests

```powershell
# Run all tests
npm test

# Run only the AI healer demo
npx playwright test tests/demo-ai-healing.spec.ts --reporter=list

# Run with a headed browser to watch healing happen live
npm run test:headed

# Clear the cache to force fresh healing on next run
Remove-Item sel-healing-report/.self-healing-cache.json
```
