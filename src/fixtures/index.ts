import { mergeTests } from "@playwright/test";
import { expect ,test as healFixtures} from "../../self-healing/fixture";
import { test as pageFixtures } from "./page-fixture";

export const test = mergeTests(pageFixtures,healFixtures);
export { expect };
