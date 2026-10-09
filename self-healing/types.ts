import type { Page } from '@playwright/test';

export type SelectorType =
  | 'css'
  | 'xpath'
  | 'role'
  | 'text'
  | 'testid'
  | 'label'
  | 'placeholder'
  | 'unknown';

export interface HealingContext {
  action: string;
  errorMessage: string;
  selectorType: SelectorType;
  pageUrl: string;
  domSnippet?: string;
}

export interface HealingResult {
  originalSelector: string;
  healedSelector: string;
  strategy: string;
  confidence: number;
  model?: string;
  timestamp: number;
}

export interface HealingStrategy {
  name: string;
  heal(page: Page, selector: string, context: HealingContext): Promise<HealingResult | null>;
}

export interface AIOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  name: string;
  sendPrompt(systemPrompt: string, userPrompt: string, options?: AIOptions): Promise<string>;
}

export interface SelectorRecord {
  originalSelector: string;
  healedSelector: string;
  strategy: string;
  confidence: number;
  healCount: number;
  lastHealed: number;
  lastUsed: number;
  pageUrl: string;
}

export interface CodeFix {
  file?: string;
  original: string;
  suggested: string;
  reason: string;
}

export interface HealingReport {
  runTimestamp: number;
  totalAttempts: number;
  healed: number;
  failed: number;
  fromCache: number;
  details: HealingResult[];
  failures: Array<{ selector: string; pageUrl: string; errorMessage: string; timestamp: number }>;
  suggestedCodeFixes: CodeFix[];
}

export interface SelfHealingConfig {
  enabled: boolean;
  aiProvider: string;
  aiModel: string;
  githubToken: string;
  openAIToken: string;
  geminiToken: string;
  maxAIHealsPerRun: number;
  cacheFilePath: string;
  reportFilePath: string;
  healingTimeoutMs: number;
  fuzzyMatchThreshold: number;
  domMaxLength: number;
  enableInCI: boolean;
}
