import path from "node:path";

export class ExploreAgent {
  readonly apiKey: string;
  readonly targetUrl: URL;
  readonly task: string;
  readonly defaultTask: string;
  readonly model: string;
  readonly maxRetries: number;
  readonly serviceUnavailableDelayMs: number;
  readonly maxRemoteCalls: number;
  readonly playwrightMcpCli: string;
  readonly unsafeToolName: string;

  constructor(environment: NodeJS.ProcessEnv = process.env, args: string[] = process.argv.slice(2)) {
    this.defaultTask = "Explore the main page and summarize its purpose, navigation, and notable interactions.";
    this.model = environment.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
    this.maxRetries = 10;
    this.serviceUnavailableDelayMs = 60_000;
    this.maxRemoteCalls = 30;
    this.playwrightMcpCli = path.resolve(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
    this.unsafeToolName = "browser_run_code_unsafe";

    const apiKey = environment.GEMINI_API_KEY ?? environment.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment or .env file.");
    }
    this.apiKey = apiKey;

    const [target, ...taskParts] = args;
    if (!target) {
      throw new Error('Usage: npm run explore -- <url> ["what to explore"]');
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      throw new Error(`Invalid URL: ${target}`);
    }

    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new Error("The target URL must use http or https.");
    }

    this.targetUrl = targetUrl;
    this.task = taskParts.join(" ").trim() || this.defaultTask;
  }
}
