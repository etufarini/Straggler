import type { Page } from '@playwright/test';

export async function settingsColorViolations(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const colors = new Map<string, boolean>();
    function isSaturatedBlue(color: string) {
      const cached = colors.get(color);
      if (cached !== undefined) return cached;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const lightness = (max + min) / 2;
      const delta = max - min;
      const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
      const hue = !delta
        ? 0
        : 60 *
          (max === r / 255
            ? ((((g - b) / 255 / delta) % 6) + 6) % 6
            : max === g / 255
              ? (b - r) / 255 / delta + 2
              : (r - g) / 255 / delta + 4);
      const forbidden =
        alpha > 0 &&
        hue >= 205 &&
        hue <= 245 &&
        saturation > 0.45 &&
        lightness >= 0.25 &&
        lightness <= 0.82;
      colors.set(color, forbidden);
      return forbidden;
    }
    const violations: { element: string; property: string; color: string }[] = [];
    const properties = [
      'color',
      'background-color',
      'background-image',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'outline-color',
      'box-shadow',
      'filter',
      'accent-color',
      'fill',
      'stroke',
    ];
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      if (node.closest('.brand-symbol') || !node.checkVisibility()) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(node, pseudo);
        if (
          pseudo &&
          (style.content === 'none' || style.content === 'normal' || style.display === 'none')
        )
          continue;
        for (const property of properties) {
          for (const color of style
            .getPropertyValue(property)
            .match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []) {
            if (isSaturatedBlue(color))
              violations.push({
                element: `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}${pseudo ?? ''}`,
                property,
                color,
              });
          }
        }
      }
    }
    return violations;
  });
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
