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

// [r, g, b, alpha] of an rgba() token
const rgbaToken = (block, name) =>
  block
    .match(new RegExp(`--${name}:\\s*rgba\\(([^)]*)\\);`, "i"))[1]
    .split(",")
    .map(Number);

// The #rrggbb a translucent color shows as over the paper color
function overPaper([r, g, b, alpha], paper) {
  return `#${[r, g, b]
    .map((channel, i) => {
      const under = parseInt(paper.slice(1 + i * 2, 3 + i * 2), 16);
      return Math.round(channel * alpha + under * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

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

    // Accent buttons (Subscribe, Play): paper-colored text on the accent,
    // also when hovered
    for (const fill of ["accent", "accent-strong"]) {
      it(`${theme}: --paper on --${fill}`, () => {
        const ratio = contrast(token(block, "paper"), token(block, fill));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }

    // Hovered archive, related and card rows: accent text on the tint
    it(`${theme}: --accent-strong on --tint`, () => {
      const paper = token(block, "paper");
      const tint = overPaper(rgbaToken(block, "tint"), paper);
      const ratio = contrast(token(block, "accent-strong"), tint);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // Badges and hovered tags: accent text on the translucent accent wash
    it(`${theme}: --accent on --accent-wash`, () => {
      const paper = token(block, "paper");
      const wash = overPaper(rgbaToken(block, "accent-wash"), paper);
      const ratio = contrast(token(block, "accent"), wash);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
