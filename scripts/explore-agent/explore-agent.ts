import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, type Content, type FunctionCall, type Part } from "@google/genai";

interface ExplorationState {
  version: 1;
  target: string;
  task: string;
  model: string;
  contents: Content[];
  pendingCalls: FunctionCall[];
  pendingResponses: Part[];
  remoteCallCount: number;
  completed: boolean;
  report?: string;
}

export class ExploreAgent {
  readonly apiKey: string;
  readonly targetUrl: URL;
  readonly task: string;
  readonly defaultTask: string;
  readonly model: string;
  readonly maxRetries: number;
  readonly maxRetryDelayMs: number;
  readonly serviceUnavailableDelayMs: number;
  readonly maxRemoteCalls: number;
  readonly playwrightMcpCli: string;
  readonly unsafeToolName: string;
  private generationRequestCount = 0;

  constructor(environment: NodeJS.ProcessEnv = process.env, args: string[] = process.argv.slice(2)) {
    this.defaultTask = "Explore the main page and summarize its purpose, navigation, and notable interactions.";
    this.model = environment.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
    this.maxRetries = 10;
    this.maxRetryDelayMs = 5 * 60_000;
    this.serviceUnavailableDelayMs = 60_000;
    this.maxRemoteCalls = 100;
    this.playwrightMcpCli = path.resolve(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
    this.unsafeToolName = "browser_run_code_unsafe";

    const apiKey = environment.GEMINI_API_KEY ?? environment.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment or .env file.");
    }
    this.apiKey = apiKey;

    // const [target, ...taskParts] = args;
    // if (!target) {
    //   throw new Error('Usage: npm run explore -- <url> ["what to explore"]');
    // }

    // let targetUrl: URL;
    // try {
    //   targetUrl = new URL(target);
    // } catch {
    //   throw new Error(`Invalid URL: ${target}`);
    // }

    // if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    //   throw new Error("The target URL must use http or https.");
    // }

    this.targetUrl  = new URL("https://www.saucedemo.com/");
    this.task = `Explore SauceDemo like a human tester without relying exclusively on predefined test cases. Discover functional defects, unexpected states, navigation issues, and potential edge cases, then produce reproducible bug reports. 1. [x] Login exploration
   Try valid credentials, invalid passwords, empty fields, and locked-out-user behavior.
2. [x] Product catalog
   Inspect product names, prices, images, sorting options, and product details.
3. [x] Shopping cart
   Add and remove products, revisit the cart, and verify cart badge consistency.
4. [x] Checkout workflow
   Explore checkout validation, missing customer information, order overview, and completion.
5. [x] Navigation and state
   Use Back, refresh, and direct URLs to discover unexpected states or broken navigation.
6. [x] Negative and edge cases
   Attempt repeated clicks, empty-cart checkout, invalid form data, and other safe edge cases.
7. [x] Bug report generation
   Capture reproduction steps, expected vs. actual results, severity, screenshots, and console errors.`;
  }

  async generateContentWithRetry(
    ai: GoogleGenAI,
    request: Parameters<typeof ai.models.generateContent>[0],
  ) {
    const requestNumber = ++this.generationRequestCount;
    for (let retry = 0; ; retry += 1) {
      try {
        return await ai.models.generateContent(request);
      } catch (error: unknown) {
        const status = this.isRecord(error) ? error.status : undefined;
        const retryDelayMs = this.getRetryDelayMs(error);
        const delayMs = status === 503
          ? retryDelayMs ?? this.serviceUnavailableDelayMs
          : status === 429
            ? retryDelayMs
            : undefined;

        if (delayMs === undefined || retry >= this.maxRetries) {
          throw error;
        }

        if (delayMs > this.maxRetryDelayMs) {
          throw new Error(
            `Gemini request ${requestNumber} asked to retry after ${Math.ceil(delayMs / 1_000)} seconds, `
            + `exceeding the ${Math.ceil(this.maxRetryDelayMs / 1_000)}-second retry limit. `
            + "Stopping instead of waiting beyond the CI job timeout.",
            { cause: error },
          );
        }

        console.warn(
          `[explore] Gemini request ${requestNumber} returned ${status}; retrying in `
          + `${Math.ceil(delayMs / 1_000)} seconds (attempt ${retry + 1}/${this.maxRetries}).`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs + 1_000));
      }
    }
  }

  async loadState(stateFilePath: string): Promise<ExplorationState> {
    if (!fs.existsSync(stateFilePath)) {
      return this.createInitialState();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.promises.readFile(stateFilePath, "utf8"));
    } catch (error: unknown) {
      throw new Error(`Unable to read exploration cache at ${stateFilePath}.`, { cause: error });
    }

    const contents = this.isRecord(parsed) && Array.isArray(parsed.contents)
      ? parsed.contents.filter((value): value is Content => this.isContent(value))
      : [];
    const pendingCalls = this.isRecord(parsed) && Array.isArray(parsed.pendingCalls)
      ? parsed.pendingCalls.filter((value): value is FunctionCall => this.isFunctionCall(value))
      : [];
    const pendingResponses = this.isRecord(parsed) && Array.isArray(parsed.pendingResponses)
      ? parsed.pendingResponses.filter((value): value is Part => this.isPart(value))
      : [];

    if (
      !this.isRecord(parsed)
      || parsed.version !== 1
      || parsed.target !== this.targetUrl.toString()
      || parsed.task !== this.task
      || parsed.model !== this.model
      || !Array.isArray(parsed.contents)
      || contents.length !== parsed.contents.length
      || !Array.isArray(parsed.pendingCalls)
      || pendingCalls.length !== parsed.pendingCalls.length
      || !Array.isArray(parsed.pendingResponses)
      || pendingResponses.length !== parsed.pendingResponses.length
      || typeof parsed.remoteCallCount !== "number"
      || !Number.isInteger(parsed.remoteCallCount)
      || parsed.remoteCallCount < 0
      || typeof parsed.completed !== "boolean"
      || (parsed.report !== undefined && typeof parsed.report !== "string")
    ) {
      throw new Error(`Exploration cache at ${stateFilePath} is invalid or does not match this request.`);
    }

    const state: ExplorationState = {
      version: 1,
      target: this.targetUrl.toString(),
      task: this.task,
      model: this.model,
      contents,
      pendingCalls,
      pendingResponses,
      remoteCallCount: parsed.remoteCallCount,
      completed: parsed.completed,
      ...(typeof parsed.report === "string" ? { report: parsed.report } : {}),
    };

    return state.completed ? this.createInitialState() : state;
  }

  async saveState(stateFilePath: string, state: ExplorationState): Promise<void> {
    const temporaryPath = `${stateFilePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.promises.rename(temporaryPath, stateFilePath);
  }

  private createInitialState(): ExplorationState {
    return {
      version: 1,
      target: this.targetUrl.toString(),
      task: this.task,
      model: this.model,
      contents: [{
        role: "user",
        parts: [{ text: `Target URL: ${this.targetUrl.toString()}\n\nExploration task: ${this.task}` }],
      }],
      pendingCalls: [],
      pendingResponses: [],
      remoteCallCount: 0,
      completed: false,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private getRetryDelayMs(error: unknown): number | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    let response: unknown;
    if (typeof error.message === "string") {
      try {
        response = JSON.parse(error.message);
      } catch {
        return undefined;
      }
    }

    const candidates: unknown[] = [error.details];
    if (this.isRecord(response) && this.isRecord(response.error)) {
      candidates.push(response.error.details);
    }

    for (const details of candidates) {
      if (!Array.isArray(details)) {
        continue;
      }

      for (const detail of details) {
        if (!this.isRecord(detail) || typeof detail["@type"] !== "string" || !detail["@type"].endsWith("RetryInfo")) {
          continue;
        }

        if (typeof detail.retryDelay === "string") {
          const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
          if (match) {
            return Number(match[1]) * 1_000;
          }
        }
      }
    }

    return undefined;
  }

  private isContent(value: unknown): value is Content {
    return this.isRecord(value)
      && (value.role === undefined || typeof value.role === "string")
      && (value.parts === undefined || (Array.isArray(value.parts) && value.parts.every((part) => this.isPart(part))));
  }

  private isFunctionCall(value: unknown): value is FunctionCall {
    return this.isRecord(value)
      && (value.name === undefined || typeof value.name === "string")
      && (value.args === undefined || this.isRecord(value.args));
  }

  private isPart(value: unknown): value is Part {
    return this.isRecord(value);
  }
}

export const exploreAgent = new ExploreAgent();
