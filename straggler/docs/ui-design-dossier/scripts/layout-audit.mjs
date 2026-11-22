// Advisory visual diagnostics. Run against frozen HTML files or the local fixture renderer.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareDesignScreen } from "../../../desktop/tests/design-scenarios.mjs";

const require = createRequire(
  new URL("../../../desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

export function measureLayout() {
  const excluded = ".settings-nav, .reasoning, .message-actions, summary";
  const visible = (element) => {
    if (element.closest("details:not([open])") && !element.closest("summary"))
      return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 1 &&
      rect.height > 1 &&
      rect.bottom > 0 &&
      rect.top < innerHeight
    );
  };
  const transparent = (color) =>
    color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  const boxed = (element) => {
    const style = getComputedStyle(element);
    return (
      element.matches("input, textarea, select, svg, img") ||
      !transparent(style.backgroundColor) ||
      style.backgroundImage !== "none" ||
      (parseFloat(style.borderLeftWidth) > 0 &&
        !transparent(style.borderLeftColor))
    );
  };
  // Walk painted boxes and text ranges, rather than counting invisible line boxes as ink.
  const ink = (element, ignoreBox = false) => {
    const boxes = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        boxes.push(...range.getClientRects());
      } else if (node.nodeType === Node.ELEMENT_NODE && visible(node)) {
        if (boxed(node) && !(ignoreBox && node === element))
          boxes.push(node.getBoundingClientRect());
        else node.childNodes.forEach(walk);
      }
    };
    walk(element);
    const painted = boxes.filter((rect) => rect.width && rect.height);
    return {
      left: Math.min(...painted.map((r) => r.left)),
      top: Math.min(...painted.map((r) => r.top)),
      bottom: Math.max(...painted.map((r) => r.bottom)),
    };
  };
  const label = (element) =>
    (element.getAttribute("aria-label") || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const eligible = (element) => visible(element) && !element.closest(excluded);
  const alignments = [];
  for (const parent of document.querySelectorAll('main *, [role="dialog"] *')) {
    const style = getComputedStyle(parent);
    if (
      !eligible(parent) ||
      (style.display.includes("flex") && style.flexDirection === "row") ||
      (style.display.includes("grid") &&
        style.gridTemplateColumns.split(" ").length > 1)
    )
      continue;
    const children = [...parent.children].filter(
      (child) =>
        eligible(child) &&
        /^(block|flex|grid)$/.test(getComputedStyle(child).display) &&
        !["absolute", "fixed"].includes(getComputedStyle(child).position),
    );
    if (children.length < 3) continue;
    const lefts = children.map((child) => Math.round(ink(child).left));
    const column = lefts.find(
      (left) =>
        Number.isFinite(left) &&
        lefts.filter((x) => Math.abs(x - left) <= 1).length >= 2,
    );
    if (column === undefined) continue;
    children.forEach((child, index) => {
      const delta = lefts[index] - column;
      if (Math.abs(delta) >= 3 && Math.abs(delta) <= 40)
        alignments.push({ element: label(child), delta });
    });
  }
  const buttons = [
    ...document.querySelectorAll(
      "button.text-button, .feedback-actions button",
    ),
  ]
    .filter(
      (button) =>
        eligible(button) &&
        !button.matches(".primary-button, .secondary-button, .danger-button"),
    )
    .map((button) => ({
      element: label(button),
      inset: Math.round(
        ink(button, true).left - button.getBoundingClientRect().left,
      ),
    }))
    .filter((button) => button.inset >= 6);
  const gaps = [];
  for (const root of document.querySelectorAll(
    '.settings-section, .model-settings-block, [role="dialog"], .composer-popover',
  )) {
    const blocks = [...root.children].filter(eligible);
    for (let index = 1; index < blocks.length; index++) {
      const previous = blocks[index - 1];
      const next = blocks[index];
      const gap = Math.round(ink(next).top - ink(previous).bottom);
      if (!Number.isFinite(gap) || gap < 0) continue;
      const dialog = !!root.closest('[role="dialog"], .composer-popover');
      const kind = next.matches("h3, .model-settings-block")
        ? "section"
        : next.matches(".field-help, .popover-note")
          ? "note"
          : "field";
      const band =
        kind === "section"
          ? [40, 48]
          : kind === "note"
            ? [8, 12]
            : dialog
              ? [16, 22]
              : [24, 30];
      gaps.push({
        from: label(previous),
        to: label(next),
        gap,
        kind,
        band,
        outside: gap < band[0] || gap > band[1],
      });
    }
  }
  return { alignments, buttons, gaps };
}

async function run() {
  const [phase = "after", ...inputs] = process.argv.slice(2);
  const review = inputs.includes("--review");
  const files = inputs.filter((input) => input !== "--review");
  const output = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../desktop/test-results/layout",
    phase,
  );
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const size of [
      [1200, 820],
      [1440, 900],
      [760, 560],
    ]) {
      const screens = review
        ? [
            "R008-OVERVIEW",
            "R008-DEFAULTS",
            "R008-PROMPTS",
            "R008-MODEL",
            "R008-LLAMA",
            "R008-FILES",
            "R008-CLOUD",
            "R008-WEB",
            "DS-FIRST",
            "DS-OOM",
            "DS-PROMPT",
            "CHAT-06",
            "CHAT-07",
            "MODEL-01",
            "DIALOG-01",
          ]
        : files.length
          ? files
          : [
              "SET-01",
              "SET-02B",
              "SET-03B",
              "CHAT-06",
              "CHAT-07",
              "MODEL-01",
              "DIALOG-01",
            ];
      for (const screen of screens) {
        const context = await browser.newContext({
          viewport: { width: size[0], height: size[1] },
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          if (files.length)
            await page.goto(pathToFileURL(resolve(screen)).href);
          else await prepareDesignScreen(page, screen);
          const result = await page.evaluate(measureLayout);
          report.push({ screen, size, ...result });
          await page.screenshot({
            path: resolve(
              output,
              `${files.length ? report.length : screen}-${size.join("x")}.png`,
            ),
          });
        } catch (error) {
          report.push({ screen, size, error: String(error) });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Advisory layout audit: ${report.length} captures, ${report.reduce((n, r) => n + (r.buttons?.length || 0), 0)} inset text buttons; ${report.filter((r) => r.error).length} capture errors. Report: ${output}`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await run().catch((error) =>
    console.error(`Advisory audit unavailable: ${error}`),
  );
}
