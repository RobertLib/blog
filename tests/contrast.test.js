import { describe, expect, it } from "vitest";
import fs from "fs";

// WCAG 2 contrast ratio between two #rrggbb colors
function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// Token blocks: light (:root), dark (data-theme) and dark (OS preference)
function themeBlocks(css) {
  const block = (start) => {
    const from = css.indexOf(start);
    return css.slice(from, css.indexOf("}", from));
  };
  return {
    light: block(":root {"),
    dark: block(':root[data-theme="dark"] {'),
    "dark (OS)": block(':root:not([data-theme="light"]) {'),
  };
}

const token = (block, name) =>
  block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))[1];

describe("Color contrast (WCAG AA, 4.5:1 for body-size text)", () => {
  const css = fs.readFileSync("static/styles.css", "utf8");

  for (const [theme, block] of Object.entries(themeBlocks(css))) {
    for (const text of ["ink", "ink-2", "ink-3", "accent"]) {
      it(`${theme}: --${text} on --paper`, () => {
        const ratio = contrast(token(block, text), token(block, "paper"));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }

    // Muted text also sits on code blocks
    it(`${theme}: --ink-3 on --sunken`, () => {
      const ratio = contrast(token(block, "ink-3"), token(block, "sunken"));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
