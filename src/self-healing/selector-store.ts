import fs from 'node:fs';
import path from 'node:path';

import { selfHealingConfig } from './config';
import type { HealingReport, HealingResult, SelectorRecord } from './types';

function createEmptyReport(): HealingReport {
  return {
    runTimestamp: Date.now(),
    totalAttempts: 0,
    healed: 0,
    failed: 0,
    fromCache: 0,
    details: [],
    failures: [],
    suggestedCodeFixes: [],
  };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function cacheKey(selector: string, pageUrl: string): string {
  return `${pageUrl}::${selector}`;
}

export class SelectorStore {
  get(originalSelector: string, pageUrl: string): SelectorRecord | null {
    const cache = readJsonFile<Record<string, SelectorRecord>>(selfHealingConfig.cacheFilePath, {});
    return cache[cacheKey(originalSelector, pageUrl)] ?? null;
  }

  delete(originalSelector: string, pageUrl: string): void {
    const cache = readJsonFile<Record<string, SelectorRecord>>(selfHealingConfig.cacheFilePath, {});
    delete cache[cacheKey(originalSelector, pageUrl)];
    writeJsonFile(selfHealingConfig.cacheFilePath, cache);
  }

  set(result: HealingResult, pageUrl: string): void {
    const cache = readJsonFile<Record<string, SelectorRecord>>(selfHealingConfig.cacheFilePath, {});
    const key = cacheKey(result.originalSelector, pageUrl);
    const existing = cache[key];
    cache[key] = {
      originalSelector: result.originalSelector,
      healedSelector: result.healedSelector,
      strategy: result.strategy,
      confidence: result.confidence,
      healCount: (existing?.healCount ?? 0) + 1,
      lastHealed: result.timestamp,
      lastUsed: result.timestamp,
      pageUrl,
    };
    writeJsonFile(selfHealingConfig.cacheFilePath, cache);
  }

  resetReport(): void {
    writeJsonFile(selfHealingConfig.reportFilePath, createEmptyReport());
  }

  recordHeal(result: HealingResult): void {
    const report = readJsonFile<HealingReport>(selfHealingConfig.reportFilePath, createEmptyReport());
    report.totalAttempts += 1;
    report.healed += 1;
    report.details.push(result);
    report.suggestedCodeFixes.push({
      original: result.originalSelector,
      suggested: result.healedSelector,
      reason: `Healed via ${result.strategy}`,
    });
    writeJsonFile(selfHealingConfig.reportFilePath, report);
  }

  recordCacheHit(record: SelectorRecord): void {
    const report = readJsonFile<HealingReport>(selfHealingConfig.reportFilePath, createEmptyReport());
    report.totalAttempts += 1;
    report.healed += 1;
    report.fromCache += 1;
    report.details.push({
      originalSelector: record.originalSelector,
      healedSelector: record.healedSelector,
      strategy: 'cache',
      confidence: record.confidence,
      timestamp: Date.now(),
    });
    writeJsonFile(selfHealingConfig.reportFilePath, report);
  }

  recordFailure(selector: string, pageUrl: string, errorMessage: string): void {
    const report = readJsonFile<HealingReport>(selfHealingConfig.reportFilePath, createEmptyReport());
    report.totalAttempts += 1;
    report.failed += 1;
    report.failures.push({ selector, pageUrl, errorMessage, timestamp: Date.now() });
    writeJsonFile(selfHealingConfig.reportFilePath, report);
  }

  getReport(): HealingReport {
    return readJsonFile<HealingReport>(selfHealingConfig.reportFilePath, createEmptyReport());
  }
}

export const selectorStore = new SelectorStore();
