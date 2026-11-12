import { describe, expect, it } from "vitest";
import fs from "fs";

const css = fs.readFileSync("static/styles.css", "utf8");

// Declarations of the rule whose selector list is exactly `selector`
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

describe("styles.css", () => {
  // A selector list left dangling when a rule is deleted silently merges
  // with whatever rule follows the comment
  it("has no selector list continuing across a comment", () => {
    expect(css).not.toMatch(/,\s*\/\*/);
  });

  it.each([".post-card__meta .dot", ".post__meta .dot"])(
    "gives the meta separator %s a visible size",
    (selector) => {
      const rule = declarations(selector);
      expect(rule).not.toBeNull();
      expect(rule).toMatch(/width:\s*3px/);
      expect(rule).toMatch(/background:/);
    }
  );

  it("styles the article lede on its own", () => {
    const rule = declarations(".post__lede");
    expect(rule).not.toBeNull();
    expect(rule).toMatch(/font-size:/);
    expect(rule).toMatch(/max-width:/);
  });
});
