import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateSEO } from "../seo-validate.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("SEO Validation Tests", () => {
  // A fresh directory outside the repository for every test
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-seo-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should return false for non-existent directory", () => {
    const result = validateSEO("non-existent-dir");
    expect(result).toBe(false);
  });

  it("should pass validation for valid HTML file", () => {
    const validHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>This is a valid title for SEO that is exactly sixty</title>
  <meta name="description" content="This is a valid meta description that is long enough to meet the minimum requirements for SEO validation and testing purposes for our unit test suites">
  <meta property="og:title" content="Valid OG Title">
  <meta property="og:description" content="Valid OG Description">
  <meta property="og:image" content="https://example.com/image.jpg">
</head>
<body>
  <h1>Test Content</h1>
</body>
</html>
    `.trim();

    fs.writeFileSync(path.join(testDir, "valid-article.html"), validHtml);

    const result = validateSEO(testDir);
    expect(result).toBe(true);
  });

  it("should fail validation for invalid HTML file", () => {
    const invalidHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Short</title>
  <meta name="description" content="Too short description">
</head>
<body>
  <h1>Test Content</h1>
</body>
</html>
    `.trim();

    fs.writeFileSync(path.join(testDir, "invalid-article.html"), invalidHtml);

    const result = validateSEO(testDir);
    expect(result).toBe(false);
  });

  const shortHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Short</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>
  `.trim();

  it("should skip 404 page and google verification files", () => {
    // These files should be skipped
    fs.writeFileSync(path.join(testDir, "404.html"), shortHtml);
    fs.writeFileSync(path.join(testDir, "google123.html"), shortHtml);

    const result = validateSEO(testDir);
    expect(result).toBe(true); // Should pass because files are skipped
  });

  it("should validate index.html", () => {
    fs.writeFileSync(path.join(testDir, "index.html"), shortHtml);

    expect(validateSEO(testDir)).toBe(false);
  });

  it("should fail when title or description is missing", () => {
    const html = `
<html><head>
  <meta property="og:title" content="T">
  <meta property="og:description" content="D">
  <meta property="og:image" content="https://example.com/i.png">
</head></html>`;
    fs.writeFileSync(path.join(testDir, "no-meta.html"), html);

    expect(validateSEO(testDir)).toBe(false);
  });

  it("should measure multi-line markup by its decoded display text", () => {
    // Title is 54 chars once entities are decoded, 63 as raw source
    const html = `
<html><head>
  <title>
    RobLib&#039;s Blog - Programming &amp; Web Development Insights
  </title>
  <link rel="canonical" href="https://example.com/multi-line.html" />
  <meta
    name="description"
    content="Expert insights on web development, JavaScript, Node.js, and programming best practices. Pragmatic solutions &amp; critical perspectives on web technologies."
  />
  <meta
    property="og:title"
    content="T"
  />
  <meta property="og:description" content="D" />
  <meta property="og:image" content="https://other.example/i.png" />
</head><body><h1>Title</h1></body></html>`;
    fs.writeFileSync(path.join(testDir, "multi-line.html"), html);

    expect(validateSEO(testDir)).toBe(true);
  });

  const page = ({ title, description, ogImage = "https://cdn.example/i.png", h1 = "<h1>T</h1>" }) => `
<html><head>
  <title>${title}</title>
  <link rel="canonical" href="https://example.com/page.html" />
  <meta name="description" content="${description}" />
  <meta property="og:title" content="T" />
  <meta property="og:description" content="D" />
  <meta property="og:image" content="${ogImage}" />
</head><body>${h1}</body></html>`;
  const okDescription =
    "A description long enough to be useful in search results, describing what the page is about in a sentence or two.";

  it("should accept short, specific titles", () => {
    fs.writeFileSync(
      path.join(testDir, "short.html"),
      page({ title: "Chuck in 600 Kilobytes", description: okDescription })
    );

    expect(validateSEO(testDir)).toBe(true);
  });

  it("should reject titles that get cut off and thin descriptions", () => {
    fs.writeFileSync(
      path.join(testDir, "long.html"),
      page({ title: "x".repeat(71), description: okDescription })
    );
    expect(validateSEO(testDir)).toBe(false);

    fs.writeFileSync(
      path.join(testDir, "long.html"),
      page({ title: "A fine title", description: "Too thin." })
    );
    expect(validateSEO(testDir)).toBe(false);
  });

  it("should require exactly one h1", () => {
    fs.writeFileSync(
      path.join(testDir, "no-h1.html"),
      page({ title: "A fine title", description: okDescription, h1: "" })
    );

    expect(validateSEO(testDir)).toBe(false);
  });

  it("should check that a local og:image was generated", () => {
    const html = page({
      title: "A fine title",
      description: okDescription,
      ogImage: "https://example.com/og/page.png",
    });
    fs.writeFileSync(path.join(testDir, "page.html"), html);
    expect(validateSEO(testDir)).toBe(false);

    fs.mkdirSync(path.join(testDir, "og"));
    fs.writeFileSync(path.join(testDir, "og", "page.png"), "");
    expect(validateSEO(testDir)).toBe(true);
  });

  it("should report a relative og:image as an error only", () => {
    const { validatePage } = require("../seo-validate.js");
    const results = validatePage(
      page({
        title: "A fine title",
        description: okDescription,
        ogImage: "og/page.png",
      }),
      testDir
    );
    const ogResults = results.filter((r) => /og:image|OG Image/.test(r.message));

    expect(ogResults).toEqual([
      { level: "error", message: "og:image is not an absolute URL: og/page.png" },
    ]);
  });

  it("should validate pages in subdirectories", () => {
    fs.mkdirSync(path.join(testDir, "tags"));
    fs.writeFileSync(path.join(testDir, "tags", "games.html"), shortHtml);

    expect(validateSEO(testDir)).toBe(false);
  });
});
