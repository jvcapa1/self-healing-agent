import type { Page } from '@playwright/test';

function trimText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export async function extractSimplifiedDOM(page: Page, maxLength: number): Promise<string> {
  const simplified = await page.evaluate(() => {
    const selectors = [
      'main',
      'header',
      'nav',
      'form',
      'section',
      'a',
      'button',
      'input',
      'textarea',
      'select',
      'label',
      '[role]',
      '[aria-label]',
      '[data-testid]',
      '[data-test]',
      '[data-cy]',
    ].join(',');

    const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 250);

    return nodes
      .map((node) => {
        const element = node as HTMLElement;
        const attrs = [
          ['id', element.getAttribute('id')],
          ['class', element.getAttribute('class')],
          ['role', element.getAttribute('role')],
          ['aria-label', element.getAttribute('aria-label')],
          ['name', element.getAttribute('name')],
          ['type', element.getAttribute('type')],
          ['placeholder', element.getAttribute('placeholder')],
          ['href', element.getAttribute('href')],
          ['data-testid', element.getAttribute('data-testid')],
          ['data-test', element.getAttribute('data-test')],
          ['data-cy', element.getAttribute('data-cy')],
        ]
          .filter(([, value]) => value)
          .map(([name, value]) => `${name}="${String(value).replace(/\s+/g, ' ').trim()}"`)
          .join(' ');

        const text = element.innerText?.replace(/\s+/g, ' ').trim() ?? '';
        return `<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>${text}</${element.tagName.toLowerCase()}>`;
      })
      .join('\n');
  });

  return trimText(simplified, maxLength * 2).slice(0, maxLength);
}

export async function extractElementContext(page: Page, _selector: string, maxLength: number): Promise<string> {
  return extractSimplifiedDOM(page, maxLength);
}
