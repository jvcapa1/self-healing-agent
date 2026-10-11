import { expect as baseExpect, test as base, type Locator, type Page } from '@playwright/test';

import { Healer } from './healer';
import type { SelectorType } from './types';
import { simpleGit } from "simple-git";


export async function pushToGitHub() {
  const git = simpleGit("/path/to/your/repo");

  await git.add(".");
  await git.commit("Update from TypeScript");
  await git.push("origin", "main");
}

const PAGE_QUERY_METHODS = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
]);

const LOCATOR_ACTION_METHODS = new Set([
  'click',
  'fill',
  'type',
  'press',
  'hover',
  'check',
  'uncheck',
  'selectOption',
  'focus',
  'waitFor',
]);

const LOCATOR_CHAIN_METHODS = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'filter',
  'first',
  'last',
  'nth',
]);

const LOCATOR_ASSERTION_METHODS = new Set([
  'toBeAttached', 'toBeChecked', 'toBeDisabled', 'toBeEditable',
  'toBeEmpty', 'toBeEnabled', 'toBeFocused', 'toBeHidden',
  'toBeInViewport', 'toBeVisible', 'toContainText', 'toHaveAccessibleDescription',
  'toHaveAccessibleName', 'toHaveAttribute', 'toHaveClass', 'toHaveCount',
  'toHaveCSS', 'toHaveId', 'toHaveJSProperty', 'toHaveRole',
  'toHaveScreenshot', 'toHaveText', 'toHaveValue', 'toHaveValues',
]);

const HEALING_PATCHED = Symbol('selfHealingPatched');
const PAGE_HEALING_PATCHED = Symbol('selfHealingPagePatched');
const SELECTOR_DESCRIPTOR = Symbol('selectorDescriptor');
const HEALER_REF = Symbol('healerRef');
const RAW_PAGE_REF = Symbol('rawPageRef');

function escapeForDoubleQuotes(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function selectorTypeFromDescriptor(selector: string): SelectorType {
  if (selector.startsWith('//') || selector.startsWith('xpath=')) {
    return 'xpath';
  }
  if (selector.startsWith('role=')) {
    return 'role';
  }
  if (selector.startsWith('text=')) {
    return 'text';
  }
  if (selector.includes('data-testid')) {
    return 'testid';
  }
  if (selector.includes('placeholder')) {
    return 'placeholder';
  }
  if (selector.includes('label')) {
    return 'label';
  }
  if (selector) {
    return 'css';
  }
  return 'unknown';
}

function isRecoverableSelectorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('waiting for locator')
    || message.includes('waiting for getby')
    || (message.includes('timeout') && message.includes('exceeded') && message.includes('waiting for'))
    || message.includes('element is not attached')
    || message.includes('strict mode violation')
    || message.includes('resolved to 0 elements')
    || message.includes('no element matches')
    || message.includes('not a valid xpath expression')
    || message.includes('not a valid css selector')
    || message.includes('invalid selector')
  );
}

function describePageQuery(method: string, args: unknown[]): string {
  switch (method) {
    case 'locator':
      return String(args[0] ?? '');
    case 'getByRole': {
      const role = String(args[0] ?? '');
      const options = (args[1] ?? {}) as { name?: string };
      return options.name ? `role=${role}[name="${escapeForDoubleQuotes(String(options.name))}"]` : `role=${role}`;
    }
    case 'getByText':
      return `text=${escapeForDoubleQuotes(String(args[0] ?? ''))}`;
    case 'getByLabel':
      return `[aria-label*="${escapeForDoubleQuotes(String(args[0] ?? ''))}" i]`;
    case 'getByPlaceholder':
      return `[placeholder*="${escapeForDoubleQuotes(String(args[0] ?? ''))}" i]`;
    case 'getByTestId':
      return `[data-testid="${escapeForDoubleQuotes(String(args[0] ?? ''))}"]`;
    default:
      return String(args[0] ?? method);
  }
}


function createHealingLocator(
  locator: Locator,
  selectorDescriptor: string,
  rawPage: Page,
  healer: Healer,
): Locator {
  const patchableLocator = locator as Locator & { [HEALING_PATCHED]?: boolean };
  if (patchableLocator[HEALING_PATCHED]) {
    return locator;
  }

  // Store healing metadata on the locator so expect() can access it
  (locator as any)[SELECTOR_DESCRIPTOR] = selectorDescriptor;
  (locator as any)[HEALER_REF] = healer;
  (locator as any)[RAW_PAGE_REF] = rawPage;

  for (const methodName of LOCATOR_ACTION_METHODS) {
    const original = Reflect.get(locator, methodName);
    if (typeof original !== 'function') {
      continue;
    }

    Reflect.set(locator, methodName, async (...args: unknown[]) => {
      try {
        return await original.apply(locator, args);
      } catch (error) {
        if (!isRecoverableSelectorError(error)) {
          throw error;
        }

        const result = await healer.heal(rawPage, selectorDescriptor, {
          action: methodName,
          errorMessage: error instanceof Error ? error.message : String(error),
          selectorType: selectorTypeFromDescriptor(selectorDescriptor),
          pageUrl: rawPage.url(),
        });

        if (!result) {
          throw error;
        }

        const healedLocator = rawPage.locator(result.healedSelector);
        const healedAction = Reflect.get(healedLocator, methodName);
        return await healedAction.apply(healedLocator, args);
      }
    });
  }

  for (const methodName of LOCATOR_CHAIN_METHODS) {
    const original = Reflect.get(locator, methodName);
    if (typeof original !== 'function') {
      continue;
    }

    Reflect.set(locator, methodName, (...args: unknown[]) => {
      const nextLocator = original.apply(locator, args) as Locator;
      const nextDescriptor = `${selectorDescriptor} >> ${describePageQuery(methodName, args)}`;
      return createHealingLocator(nextLocator, nextDescriptor, rawPage, healer);
    });
  }

  patchableLocator[HEALING_PATCHED] = true;
  return locator;
}

function createSelfHealingPage(page: Page, healer: Healer): Page {
  const patchablePage = page as Page & { [PAGE_HEALING_PATCHED]?: boolean };
  if (patchablePage[PAGE_HEALING_PATCHED]) {
    return page;
  }

  for (const methodName of PAGE_QUERY_METHODS) {
    const original = Reflect.get(page, methodName);
    if (typeof original !== 'function') {
      continue;
    }

    Reflect.set(page, methodName, (...args: unknown[]) => {
      const locator = original.apply(page, args) as Locator;
      const descriptor = describePageQuery(methodName, args);
      return createHealingLocator(locator, descriptor, page, healer);
    });
  }

  patchablePage[PAGE_HEALING_PATCHED] = true;
  return page;
}

export const test = base.extend<{ selfHealingPage: Page }>({
  selfHealingPage: async ({ page }, use) => {
    const healer = new Healer();
    await use(createSelfHealingPage(page, healer));
    await pushToGitHub(); // Push changes to GitHub after the test
  },
});

function wrapAssertionsWithHealing(assertions: any, descriptor: string, healer: Healer, page: Page): any {
  return new Proxy(assertions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop !== 'string' || !LOCATOR_ASSERTION_METHODS.has(prop) || typeof value !== 'function') {
        return value;
      }

      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          if (!isRecoverableSelectorError(error)) {
            throw error;
          }

          const result = await healer.heal(page, descriptor, {
            action: `expect.${prop}`,
            errorMessage: error instanceof Error ? error.message : String(error),
            selectorType: selectorTypeFromDescriptor(descriptor),
            pageUrl: page.url(),
          });

          if (!result) {
            throw error;
          }

          const healedLocator = page.locator(result.healedSelector);
          return await (baseExpect(healedLocator) as any)[prop](...args);
        }
      };
    },
  });
}

export const expect = new Proxy(baseExpect, {
  apply(_target, _thisArg, argArray: [unknown, ...unknown[]]) {
    const [target, ...rest] = argArray;
    const assertions = (baseExpect as Function)(target, ...rest);

    const descriptor = (target as any)?.[SELECTOR_DESCRIPTOR];
    const healer = (target as any)?.[HEALER_REF];
    const page = (target as any)?.[RAW_PAGE_REF];

    if (!descriptor || !healer || !page) {
      return assertions;
    }

    return wrapAssertionsWithHealing(assertions, descriptor, healer, page);
  },
}) as typeof baseExpect;



