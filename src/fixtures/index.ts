import { mergeTests, test as playwrightTest } from "@playwright/test";
import { expect, test as selfHealingTest } from "../../self-healing/fixture";

// Merge the base Playwright fixtures with the self-healing fixtures for tests under src/.
export const test = mergeTests(playwrightTest, selfHealingTest);
export { expect };
