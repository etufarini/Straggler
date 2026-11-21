import { expect, test } from '@playwright/test';
import { contrastRatio } from '../designColors';

test('text, primary actions, links and focus meet AA on the actual theme surfaces', async ({
  page,
}) => {
  await page.goto('/?scenario=web-normal');
  for (const area of ['chat', 'cloud', 'settings']) {
    if (area === 'cloud') await page.goto('/?scenario=cloud-ready');
    if (area === 'settings')
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const palette = await page.locator('body').evaluate((node) => {
      const style = getComputedStyle(node);
      const value = (name: string) => style.getPropertyValue(name).trim();
      return {
        tertiary: value('--ui-text-3'),
        link: value('--ui-accent-text'),
        focus: value('--ui-focus'),
        primary: value('--ui-primary'),
        primaryHover: value('--ui-primary-hover'),
        surfaces: [
          '--ui-elev-0',
          '--ui-elev-1',
          '--ui-elev-2',
          '--ui-elev-3',
          '--ui-raised-2',
          '--ui-field',
          '--ui-code',
          '--ui-surface',
        ].map(value),
      };
    });
    for (const background of [palette.primary, palette.primaryHover].flatMap(
      (gradient) => gradient.match(/#[0-9a-f]{6}/gi) ?? [],
    ))
      expect(contrastRatio('#ffffff', background), `${area} primary`).toBeGreaterThanOrEqual(4.5);
    if (area === 'cloud') {
      await expect(page.locator('body')).toHaveAttribute('data-model', 'cloud');
      await page.getByRole('button', { name: /^Reasoning/ }).focus();
      await expect(page.locator(':focus-visible')).toHaveCSS('outline-style', 'solid');
    }
    if (area === 'settings')
      await expect(page.locator('body')).not.toHaveAttribute('data-model', 'cloud');
    for (const background of palette.surfaces) {
      expect(
        contrastRatio(palette.tertiary, background),
        `${area} tertiary on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette.link, background),
        `${area} link on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette.focus, background),
        `${area} focus on ${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
  const apply = page.getByRole('button', { name: 'Apply changes', exact: true });
  for (const hovered of [false, true]) {
    if (hovered) await apply.hover();
    const colors = await apply.evaluate((button) => {
      const style = getComputedStyle(button);
      const context = document.createElement('canvas').getContext('2d')!;
      function hex(color: string) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return (
          '#' +
          [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')
        );
      }
      return {
        foreground: hex(style.color),
        backgrounds: (
          style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [style.backgroundColor]
        ).map(hex),
      };
    });
    for (const background of colors.backgrounds)
      expect(contrastRatio(colors.foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
});

test('sampling shares its default hint while retaining each field description', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Fine-tune reply style', { exact: true }).click();
  const group = page.locator('.sampling-details');
  await expect(group.locator('summary + .field-help')).toHaveText(
    'Leave a field empty to use the llama.cpp default.',
  );
  await expect(
    group.getByText('Leave a field empty to use the llama.cpp default.', { exact: true }),
  ).toHaveCount(1);
  const descriptions = await group.locator('input').evaluateAll((inputs) =>
    inputs.map((input) => {
      const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
      return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    }),
  );
  expect(descriptions).toHaveLength(7);
  for (const description of descriptions) {
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toContain('llama.cpp default');
  }
});
