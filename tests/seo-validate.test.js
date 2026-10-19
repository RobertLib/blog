import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateSEO } from "../seo-validate.js";
import fs from "fs";
import path from "path";

describe("SEO Validation Tests", () => {
  const testDir = "test-dist";

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
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
  <meta
    name="description"
    content="Expert insights on web development, JavaScript, Node.js, and programming best practices. Pragmatic solutions &amp; critical perspectives on web technologies."
  />
  <meta
    property="og:title"
    content="T"
  />
  <meta property="og:description" content="D" />
  <meta property="og:image" content="https://example.com/i.png" />
</head></html>`;
    fs.writeFileSync(path.join(testDir, "multi-line.html"), html);

    expect(validateSEO(testDir)).toBe(true);
  });
});
