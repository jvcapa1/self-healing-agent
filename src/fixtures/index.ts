import { mergeTests, test as playwrightTest } from "@playwright/test";
import { expect, test as selfHealingTest } from "../../self-healing/fixture";

export const test = mergeTests(playwrightTest, selfHealingTest);
export { expect };
