import type { FullResult, Reporter } from '@playwright/test/reporter';

import { selectorStore } from './selector-store';

class SelfHealingReporter implements Reporter {
  onBegin(): void {
    selectorStore.resetReport();
  }

  onEnd(_result: FullResult): void {
    const report = selectorStore.getReport();

    if (report.totalAttempts === 0) {
      return;
    }

    console.log('\n[self-healing] Summary');
    console.log(`[self-healing] Healed: ${report.healed} | From cache: ${report.fromCache} | Failed: ${report.failed}`);

    for (const detail of report.details) {
      console.log(
        `[self-healing] ${detail.originalSelector} -> ${detail.healedSelector} (${detail.strategy}${detail.model ? `:${detail.model}` : ''})`,
      );
    }
  }
}

export default SelfHealingReporter;
