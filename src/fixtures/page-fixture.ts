import { expect, test as base } from "../../self-healing/fixture";
import { HomePage } from "../pages/home-page";

export const test = base.extend<{ homePage: HomePage }>({
  homePage: async ({ selfHealingPage }, use) => {
    await use(new HomePage(selfHealingPage));
  },
});

export { expect };