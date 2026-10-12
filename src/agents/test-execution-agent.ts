import { GoogleGenAI } from "@google/genai";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

type TestRecord = {
  title: string;
  file: string;
  status: string;
  duration: number;
  error?: string;
};

type HealingReport = {
  totalAttempts?: number;
  healed?: number;
  failed?: number;
  fromCache?: number;
  details?: Array<{
    originalSelector: string;
    healedSelector: string;
    strategy: string;
  }>;
};

type Verdict = {
  test?: string;
  category?: string;
  confidence?: number;
  root_cause?: string;
  evidence?: string[];
  healing_review?: { was_healed?: boolean; verdict?: string; reason?: string };
  recommended_fix?: { type?: string; old?: string | null; new?: string | null; explanation?: string };
  severity?: string;
  needs_human_review?: boolean;
};

type Analysis = {
  summary: string[];
  verdicts: Verdict[];
  note?: string;
  raw?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  LOCATOR_CHANGED: "Locator changed",
  ELEMENT_MISSING: "Element missing",
  TIMING_FLAKY: "Timing / flaky",
  APP_BUG: "App bug",
  TEST_BUG: "Test bug",
  ENVIRONMENT: "Environment",
};

const FIX_LABELS: Record<string, string> = {
  UPDATE_SELECTOR: "Update selector",
  ADD_WAIT_CONDITION: "Add wait condition",
  FIX_ASSERTION: "Fix assertion",
  REPORT_APP_BUG: "Report app bug",
  FIX_ENVIRONMENT: "Fix environment",
  NONE: "No action needed",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

/** Playwright error messages contain ANSI colour codes that look like garbage in a PDF. */
function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}\n… (truncated)` : value;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function isFailure(status: string): boolean {
  return status === "failed" || status === "timedOut" || status === "interrupted";
}

function getLocalAnalysis(tests: TestRecord[], healing: HealingReport, status: string): string[] {
  const failed = tests.filter((test) => isFailure(test.status));
  const flaky = tests.filter((test) => test.status === "flaky");
  const lines = [`Playwright finished with status: ${status}.`];

  if (failed.length === 0 && flaky.length === 0) {
    lines.push("All tests passed without retries.");
  } else {
    if (failed.length) {
      lines.push(`${failed.length} test(s) failed or timed out. Review the error details below and check whether each failure comes from an application change, test data, or a selector issue.`);
    }
    if (flaky.length) {
      lines.push(`${flaky.length} test(s) passed only after a retry. Investigate timing, shared state, or environment instability.`);
    }
  }

  if ((healing.totalAttempts ?? 0) > 0) {
    lines.push(`Self-healing handled ${healing.healed ?? 0} selector issue(s), including ${healing.fromCache ?? 0} cache hit(s); ${healing.failed ?? 0} healing attempt(s) failed.`);
  } else {
    lines.push("No self-healing selector attempts were recorded.");
  }

  return lines;
}

/** Gemini is asked for JSON, but may still wrap it in fences. Accepts one object or an array. */
function parseVerdicts(text: string): Verdict[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((item) => item && typeof item === "object");
  } catch {
    return null;
  }
}

class TestExecutionAgent implements Reporter {
  private readonly tests: TestRecord[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    // Keep only the final attempt per test; mark retried-then-passed tests as flaky.
    const title = test.titlePath().filter(Boolean).join(" › ");
    const status = result.status === "passed" && result.retry > 0 ? "flaky" : result.status;
    const record: TestRecord = {
      title,
      file: path.relative(process.cwd(), test.location.file),
      status,
      duration: result.duration,
      error: result.error?.message ? stripAnsi(result.error.message) : undefined,
    };
    const existing = this.tests.findIndex((item) => item.title === title && item.file === record.file);
    if (existing >= 0) {
      this.tests[existing] = record;
    } else {
      this.tests.push(record);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    const outputDirectory = path.resolve(process.cwd(), "playwright-report");
    const healing = await this.readHealingReport();
    const analysis = await this.analyze(healing, result.status);
    const html = this.renderHtml(result, healing, analysis);

    await fs.mkdir(outputDirectory, { recursive: true });
    const reportPath = path.join(outputDirectory, "test-analysis.pdf");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({
        path: reportPath,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="width:100%;font:9px system-ui,sans-serif;color:#8a94a6;text-align:center;">
          Test execution analysis · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        margin: { top: "14mm", right: "12mm", bottom: "16mm", left: "12mm" },
      });
    } finally {
      await browser.close();
    }
    await fs.rm(path.join(outputDirectory, "test-analysis.html"), { force: true });
    console.log(`[test-analysis] PDF report written to ${path.join("playwright-report", "test-analysis.pdf")}`);
    this.openReport(reportPath);
  }

  private openReport(reportPath: string): void {
    const setting = process.env.TEST_ANALYSIS_OPEN?.toLowerCase();
    const shouldOpen = setting === "true" || (setting !== "false" && !process.env.CI);
    if (!shouldOpen) {
      return;
    }

    const reportUrl = pathToFileURL(reportPath).href;
    const [command, args] = process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", reportUrl]]
      : process.platform === "darwin"
        ? ["open", [reportUrl]]
        : ["xdg-open", [reportUrl]];

    const opener = spawn(command, args, { detached: true, stdio: "ignore" });
    opener.on("error", (error) => {
      console.warn(`[test-analysis] Could not open the report automatically: ${error.message}`);
    });
    opener.unref();
  }

  private async readHealingReport(): Promise<HealingReport> {
    try {
      const reportPath = path.resolve(process.cwd(), "self-healing-report", ".self-healing-report.json");
      return JSON.parse(await fs.readFile(reportPath, "utf8")) as HealingReport;
    } catch {
      return {};
    }
  }

  private async analyze(healing: HealingReport, status: string): Promise<Analysis> {
    const summary = getLocalAnalysis(this.tests, healing, status);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { summary, verdicts: [], note: "Gemini analysis was skipped because GEMINI_API_KEY is not configured." };
    }

    // Only send tests that need a verdict; nothing to analyse means no API call.
    const interesting = this.tests.filter((test) => test.status !== "passed" && test.status !== "skipped");
    const hasHealing = (healing.healed ?? 0) > 0 || (healing.details?.length ?? 0) > 0;
    if (interesting.length === 0 && !hasHealing) {
      return { summary, verdicts: [], note: "No failures, flaky tests, or healed selectors, so no AI analysis was needed." };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
        contents: [
          `You are a senior test-automation analyst for Playwright (TypeScript) suites that use a self-healing locator layer. After a test run, you receive evidence for the failed, flaky or healed tests and must decide, for EACH one, why it failed and what to do about it.

RULES
1. Ground every claim in the evidence provided (error, stack trace, DOM, screenshot, healing log). If the evidence is insufficient, say so and lower your confidence. Never invent selectors, elements, or page content you were not shown.
2. Classify the failure into exactly one category:
   - LOCATOR_CHANGED: the element exists but the selector no longer matches (renamed id/class, moved DOM, changed text)
   - ELEMENT_MISSING: the feature or element was removed or is not rendered (likely a real app change or bug)
   - TIMING_FLAKY: element appears late, animation, race condition, loading state, intermittent
   - APP_BUG: the app behaves incorrectly (wrong value, wrong state, console/network error)
   - TEST_BUG: bad assertion, wrong test data, wrong test logic
   - ENVIRONMENT: network, auth/session expiry, test data missing, CI or browser issue
3. Judge whether self-healing was SAFE. Healing is safe only when the healed element is clearly the same intended element. Flag a healing as UNSAFE if it could hide a real bug (for example the test passed but clicked a different element, or an assertion on text/value was "healed").
4. When recommending a new selector, prefer in this order: getByRole (with name), getByTestId, getByLabel, getByText, then stable CSS. Avoid nth-child, auto-generated classes, and long XPath chains.
5. Be concise and specific. No generic advice like "add more waits".

OUTPUT
Return ONLY a valid JSON array with one object per test, no markdown fences and no extra text. Each object matches this schema:
{
  "test": string,
  "category": "LOCATOR_CHANGED" | "ELEMENT_MISSING" | "TIMING_FLAKY" | "APP_BUG" | "TEST_BUG" | "ENVIRONMENT",
  "confidence": number,              // 0.0 to 1.0
  "root_cause": string,              // 1-3 sentences
  "evidence": string[],              // quotes or facts from the input that support the verdict
  "healing_review": {
    "was_healed": boolean,
    "verdict": "SAFE" | "UNSAFE" | "NOT_APPLICABLE",
    "reason": string
  },
  "recommended_fix": {
    "type": "UPDATE_SELECTOR" | "ADD_WAIT_CONDITION" | "FIX_ASSERTION" | "REPORT_APP_BUG" | "FIX_ENVIRONMENT" | "NONE",
    "old": string | null,
    "new": string | null,            // Playwright locator code, or null
    "explanation": string
  },
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "needs_human_review": boolean
}`,
          JSON.stringify({ runStatus: status, tests: interesting, selfHealing: healing }),
        ].join("\n\n"),
      });

      const text = response.text?.trim();
      if (!text) {
        return { summary, verdicts: [], note: "Gemini returned an empty response; showing the local analysis only." };
      }
      const verdicts = parseVerdicts(text);
      return verdicts
        ? { summary, verdicts }
        : { summary, verdicts: [], raw: text, note: "Gemini's response was not valid JSON, so it is shown as plain text." };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { summary, verdicts: [], note: `Gemini analysis failed; showing the local analysis instead. ${reason}` };
    }
  }

  private renderVerdict(verdict: Verdict): string {
    const severity = String(verdict.severity ?? "").toUpperCase();
    const category = String(verdict.category ?? "");
    const confidence = Math.max(0, Math.min(1, Number(verdict.confidence ?? 0)));
    const healing = verdict.healing_review;
    const fix = verdict.recommended_fix;
    const evidence = (verdict.evidence ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");

    const healingBlock = healing && healing.verdict && healing.verdict !== "NOT_APPLICABLE"
      ? `<div class="block">
          <h4>Self-healing review <span class="tag h-${escapeHtml(String(healing.verdict).toLowerCase())}">${escapeHtml(healing.verdict)}</span></h4>
          <p>${escapeHtml(healing.reason ?? "")}</p>
        </div>`
      : "";

    const hasSelectors = Boolean(fix?.old || fix?.new);
    const fixBlock = fix
      ? `<div class="block">
          <h4>Recommended fix <span class="tag fix">${escapeHtml(FIX_LABELS[fix.type ?? ""] ?? fix.type ?? "")}</span></h4>
          <p>${escapeHtml(fix.explanation ?? "")}</p>
          ${hasSelectors ? `<div class="diff">
            ${fix.old ? `<div class="del"><span>−</span><code>${escapeHtml(fix.old)}</code></div>` : ""}
            ${fix.new ? `<div class="add"><span>+</span><code>${escapeHtml(fix.new)}</code></div>` : ""}
          </div>` : ""}
        </div>`
      : "";

    return `
      <article class="verdict sev-${escapeHtml(severity.toLowerCase() || "none")}">
        <div class="verdict-head">
          <h3>${escapeHtml(verdict.test ?? "Unnamed test")}</h3>
          <div class="tags">
            ${severity ? `<span class="tag sev">${escapeHtml(severity)}</span>` : ""}
            ${category ? `<span class="tag cat">${escapeHtml(CATEGORY_LABELS[category] ?? category)}</span>` : ""}
            ${verdict.needs_human_review ? `<span class="tag review">Needs human review</span>` : ""}
          </div>
        </div>
        <div class="conf">
          <span>Confidence</span>
          <div class="conf-bar"><i style="width:${Math.round(confidence * 100)}%"></i></div>
          <b>${Math.round(confidence * 100)}%</b>
        </div>
        <div class="block">
          <h4>Root cause</h4>
          <p>${escapeHtml(verdict.root_cause ?? "")}</p>
        </div>
        ${evidence ? `<div class="block"><h4>Evidence</h4><ul>${evidence}</ul></div>` : ""}
        ${healingBlock}
        ${fixBlock}
      </article>`;
  }

  private renderHtml(result: FullResult, healing: HealingReport, analysis: Analysis): string {
    const count = (predicate: (test: TestRecord) => boolean) => this.tests.filter(predicate).length;
    const passed = count((test) => test.status === "passed");
    const flaky = count((test) => test.status === "flaky");
    const failed = count((test) => isFailure(test.status));
    const skipped = count((test) => test.status === "skipped");
    const total = Math.max(passed + flaky + failed + skipped, 1);
    const pct = (value: number) => (value / total) * 100;
    const totalDuration = this.tests.reduce((sum, test) => sum + test.duration, 0);

    // Failures first, then flaky, then the rest.
    const order = (status: string) => (isFailure(status) ? 0 : status === "flaky" ? 1 : status === "skipped" ? 3 : 2);
    const sorted = [...this.tests].sort((a, b) => order(a.status) - order(b.status));

    const rows = sorted.map((test) => `
      <tr>
        <td><div class="t-title">${escapeHtml(test.title)}</div><small>${escapeHtml(test.file)}</small>
          ${test.error ? `<pre>${escapeHtml(truncate(test.error, 900))}</pre>` : ""}</td>
        <td><span class="status ${escapeHtml(test.status)}">${escapeHtml(test.status)}</span></td>
        <td class="num">${formatDuration(test.duration)}</td>
      </tr>`).join("");

    const healingRows = (healing.details ?? []).map((detail) => `
      <tr>
        <td><code>${escapeHtml(detail.originalSelector)}</code></td>
        <td><code>${escapeHtml(detail.healedSelector)}</code></td>
        <td><span class="tag cat">${escapeHtml(detail.strategy)}</span></td>
      </tr>`).join("");

    const summaryHtml = analysis.summary.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const verdictsHtml = analysis.verdicts.map((verdict) => this.renderVerdict(verdict)).join("");
    const noteHtml = analysis.note ? `<p class="note">${escapeHtml(analysis.note)}</p>` : "";
    const rawHtml = analysis.raw ? `<pre class="raw">${escapeHtml(analysis.raw)}</pre>` : "";

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test execution analysis</title>
  <style>
    :root {
      --bg: #f3f5f9; --surface: #ffffff; --surface-2: #f8fafc; --border: #e2e7f0;
      --text: #172033; --muted: #637087; --accent: #4f46e5; --accent-soft: #eef0ff;
      --pass: #15803d; --pass-soft: #e8f6ee; --fail: #b42318; --fail-soft: #fdecea;
      --warn: #b45309; --warn-soft: #fef3e2; --skip: #64748b; --skip-soft: #eef1f5;
      --heal: #7c3aed; --heal-soft: #f3ecff;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html { font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { margin: 0; color: var(--text); background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { max-width: 1100px; margin: 0 auto; }

    /* Header */
    header {
      background: linear-gradient(135deg, #312e81 0%, #4f46e5 55%, #7c3aed 100%);
      color: #fff; padding: 26px 28px; border-radius: 14px; margin-bottom: 16px;
    }
    .eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; opacity: .75; margin: 0 0 6px; }
    h1 { margin: 0; font-size: 26px; line-height: 1.2; letter-spacing: -.01em; }
    .meta { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 12px; opacity: .95; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: capitalize; border: 1px solid rgba(255,255,255,.35);
      background: rgba(255,255,255,.18);
    }
    .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .pill.passed { background: rgba(34,197,94,.3); }
    .pill.failed, .pill.timedout, .pill.interrupted { background: rgba(239,68,68,.35); }

    /* Summary cards */
    .cards { display: grid; gap: 10px; grid-template-columns: repeat(5, 1fr); }
    .card {
      position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 14px 14px 12px; font-size: 11px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: .05em;
    }
    .card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 4px; background: var(--skip); }
    .card strong { display: block; margin-top: 4px; font-size: 26px; line-height: 1.1; color: var(--text); letter-spacing: -.01em; text-transform: none; }
    .card.pass::before { background: var(--pass); } .card.pass strong { color: var(--pass); }
    .card.fail::before { background: var(--fail); } .card.fail strong { color: var(--fail); }
    .card.warn::before { background: var(--warn); } .card.warn strong { color: var(--warn); }
    .card.heal::before { background: var(--heal); } .card.heal strong { color: var(--heal); }

    /* Pass-rate bar */
    .rate { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-top: 10px; }
    .rate-top { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--muted); }
    .rate-top b { color: var(--text); }
    .bar { display: flex; height: 9px; margin-top: 8px; border-radius: 999px; overflow: hidden; background: var(--skip-soft); }
    .bar i { display: block; height: 100%; }
    .b-pass { background: var(--pass); } .b-warn { background: var(--warn); } .b-fail { background: var(--fail); } .b-skip { background: var(--skip); opacity: .5; }
    .legend { display: flex; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--muted); }
    .legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; background: var(--c); }

    /* Sections */
    section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin: 14px 0; overflow: hidden; }
    section > h2 { margin: 0; padding: 12px 18px; font-size: 13px; letter-spacing: .02em; border-bottom: 1px solid var(--border); background: var(--surface-2); }
    section > h2 small { display: inline; margin-left: 8px; font-weight: 500; }
    .body { padding: 16px 18px; }
    .overview p { margin: 0 0 8px; }
    .overview p:last-child { margin-bottom: 0; }
    .overview { background: var(--accent-soft); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; }
    .note { margin: 12px 0 0; padding: 9px 12px; background: var(--warn-soft); border-radius: 8px; color: var(--warn); font-size: 12px; }

    /* Verdict cards */
    .verdict { border: 1px solid var(--border); border-left: 5px solid var(--skip); border-radius: 10px; padding: 14px 16px; margin-top: 12px; break-inside: avoid; }
    .verdict.sev-critical { border-left-color: #7f1d1d; } .verdict.sev-high { border-left-color: var(--fail); }
    .verdict.sev-medium { border-left-color: var(--warn); } .verdict.sev-low { border-left-color: var(--pass); }
    .verdict-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .verdict-head h3 { margin: 0; font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; flex-shrink: 0; max-width: 45%; }
    .tag { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--skip-soft); color: var(--skip); white-space: nowrap; }
    .tag.sev { background: var(--skip-soft); }
    .sev-critical .tag.sev { background: #7f1d1d; color: #fff; } .sev-high .tag.sev { background: var(--fail-soft); color: var(--fail); }
    .sev-medium .tag.sev { background: var(--warn-soft); color: var(--warn); } .sev-low .tag.sev { background: var(--pass-soft); color: var(--pass); }
    .tag.cat { background: var(--accent-soft); color: var(--accent); }
    .tag.review { background: var(--warn-soft); color: var(--warn); }
    .tag.fix { background: var(--heal-soft); color: var(--heal); }
    .tag.h-safe { background: var(--pass-soft); color: var(--pass); } .tag.h-unsafe { background: var(--fail-soft); color: var(--fail); }
    .conf { display: flex; align-items: center; gap: 10px; margin: 10px 0 2px; font-size: 11px; color: var(--muted); font-weight: 600; }
    .conf-bar { flex: 0 0 140px; height: 6px; background: var(--skip-soft); border-radius: 999px; overflow: hidden; }
    .conf-bar i { display: block; height: 100%; background: var(--accent); }
    .conf b { color: var(--text); }
    .block { margin-top: 10px; }
    .block h4 { margin: 0 0 3px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); display: flex; gap: 8px; align-items: center; }
    .block p { margin: 0; } .block ul { margin: 0; padding-left: 18px; } .block li { margin: 2px 0; }
    .diff { margin-top: 8px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font: 11.5px/1.5 var(--mono); }
    .diff div { display: flex; gap: 8px; padding: 5px 10px; }
    .diff code { background: none; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    .diff .del { background: var(--fail-soft); color: var(--fail); } .diff .add { background: var(--pass-soft); color: var(--pass); }

    /* Tables */
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; vertical-align: top; padding: 10px 18px; }
    thead th { background: var(--surface-2); color: var(--muted); font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    tbody td { border-bottom: 1px solid var(--border); }
    tbody tr:last-child td { border-bottom: 0; }
    tr { break-inside: avoid; }
    td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
    td[colspan] { text-align: center; color: var(--muted); padding: 22px; }
    .t-title { font-weight: 600; overflow-wrap: anywhere; }
    small { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
    pre { margin: 8px 0 0; padding: 8px 10px; background: var(--fail-soft); border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.45 var(--mono); color: var(--fail); }
    pre.raw { background: var(--skip-soft); color: var(--text); }
    code { font: 11.5px var(--mono); background: var(--skip-soft); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
    .status { font-weight: 700; white-space: nowrap; text-transform: capitalize; }
    .status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; margin-right: 7px; }
    .passed { color: var(--pass); } .failed, .timedOut, .interrupted { color: var(--fail); } .flaky { color: var(--warn); } .skipped { color: var(--skip); }

    footer { margin-top: 18px; text-align: center; font-size: 11px; color: var(--muted); }
    @page { size: A4; margin: 14mm 12mm 16mm; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="eyebrow">Playwright · Self-healing run</p>
      <h1>Test execution analysis</h1>
      <div class="meta">
        <span>Generated ${escapeHtml(new Date().toLocaleString())}</span>
        <span>${this.tests.length} test(s) · ${formatDuration(totalDuration)}</span>
        <span class="pill ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span>
      </div>
    </header>

    <div class="cards">
      <div class="card pass">Passed<strong>${passed}</strong></div>
      <div class="card fail">Failed<strong>${failed}</strong></div>
      <div class="card warn">Flaky<strong>${flaky}</strong></div>
      <div class="card">Skipped<strong>${skipped}</strong></div>
      <div class="card heal">Healed<strong>${healing.healed ?? 0}</strong></div>
    </div>

    <div class="rate">
      <div class="rate-top"><span>Pass rate</span><b>${Math.round(pct(passed + flaky))}%</b></div>
      <div class="bar" aria-hidden="true">
        <i class="b-pass" style="width:${pct(passed)}%"></i>
        <i class="b-warn" style="width:${pct(flaky)}%"></i>
        <i class="b-fail" style="width:${pct(failed)}%"></i>
        <i class="b-skip" style="width:${pct(skipped)}%"></i>
      </div>
      <div class="legend">
        <span style="--c:var(--pass)">Passed</span><span style="--c:var(--warn)">Flaky</span>
        <span style="--c:var(--fail)">Failed</span><span style="--c:var(--skip)">Skipped</span>
      </div>
    </div>

    <section>
      <h2>Agent analysis</h2>
      <div class="body">
        <div class="overview">${summaryHtml}</div>
        ${noteHtml}
        ${verdictsHtml}
        ${rawHtml}
      </div>
    </section>

    <section>
      <h2>Test results<small>failures first</small></h2>
      <table>
        <thead><tr><th>Test</th><th>Status</th><th>Duration</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3">No tests were recorded.</td></tr>`}</tbody>
      </table>
    </section>

    <section>
      <h2>Self-healing details
        <small>${healing.totalAttempts ?? 0} attempt(s) · ${healing.healed ?? 0} healed · ${healing.failed ?? 0} failed · ${healing.fromCache ?? 0} cache hit(s)</small>
      </h2>
      <table>
        <thead><tr><th>Original selector</th><th>Healed selector</th><th>Strategy</th></tr></thead>
        <tbody>${healingRows || `<tr><td colspan="3">No healing details.</td></tr>`}</tbody>
      </table>
    </section>

    <footer>Generated by playwright-self-healing</footer>
  </div>
</body>
</html>`;
  }
}

export default TestExecutionAgent;