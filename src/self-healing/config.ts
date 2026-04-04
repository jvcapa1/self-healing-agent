import path from 'node:path';

import type { SelfHealingConfig } from './types';

require('dotenv').config();

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSelfHealingConfig(): SelfHealingConfig {
  return {
    enabled: readBoolean(process.env.SELF_HEALING_ENABLED, true),
    aiProvider: process.env.AI_PROVIDER ?? 'github-models',
    aiModel: process.env.AI_MODEL ?? 'gpt-4o-mini',
    githubToken: process.env.GITHUB_TOKEN ?? '',
    maxAIHealsPerRun: readNumber(process.env.MAX_AI_HEALS_PER_RUN, 5),
    cacheFilePath: path.resolve(process.cwd(), 'tests', 'self-healing', '.self-healing-cache.json'),
    reportFilePath: path.resolve(process.cwd(), 'tests', 'self-healing', '.self-healing-report.json'),
    healingTimeoutMs: readNumber(process.env.SELF_HEALING_TIMEOUT_MS, 15000),
    fuzzyMatchThreshold: readNumber(process.env.FUZZY_MATCH_THRESHOLD, 0.45),
    domMaxLength: readNumber(process.env.DOM_MAX_LENGTH, 4000),
    enableInCI: readBoolean(process.env.SELF_HEALING_ENABLE_IN_CI, false),
  };
}

export const selfHealingConfig = getSelfHealingConfig();
