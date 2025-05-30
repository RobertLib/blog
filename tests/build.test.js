import { describe, expect, it } from "vitest";
import * as build from "../build.js";

describe("Blog Build Functions - Pure Unit Tests", () => {
  describe("extractMetadata", () => {
    it("should extract metadata from HTML comments", () => {
      const content = `
        <!-- title: Test Article -->
        <!-- date: 2024-01-01 -->
        <!-- description: This is a test article -->
        <h1>Content</h1>
        <p>Article content here</p>
      `;

      const result = build.extractMetadata(content);

      expect(result.metadata).toEqual({
        title: "Test Article",
        date: "2024-01-01",
        description: "This is a test article",
      });
      expect(result.content).toContain("<h1>Content</h1>");
      expect(result.content).not.toContain("<!-- title:");
    });

    it("should handle content without metadata", () => {
      const content = "<h1>Just content</h1>";
      const result = build.extractMetadata(content);

      expect(result.metadata).toEqual({});
      expect(result.content).toBe("<h1>Just content</h1>");
    });

    it("should handle mixed case metadata keys", () => {
      const content = "<!-- Title: Test --> <!-- DATE: 2024-01-01 -->";
      const result = build.extractMetadata(content);

      expect(result.metadata).toEqual({
        title: "Test",
        date: "2024-01-01",
      });
    });
  });

  describe("formatDate", () => {
    it("should format valid date string", () => {
      const result = build.formatDate("2024-01-15");
      expect(result).toBe("January 15, 2024");
    });

    it("should handle empty date string", () => {
      const result = build.formatDate("");
      expect(result).toBe("");
    });

    it("should throw error for invalid date", () => {
      expect(() => build.formatDate("invalid-date")).toThrow(
        "Invalid date format"
      );
    });

    it("should handle null/undefined date", () => {
      expect(build.formatDate(null)).toBe("");
      expect(build.formatDate(undefined)).toBe("");
    });
  });

  describe("formatDateISO", () => {
    it("should format date to ISO string", () => {
      const result = build.formatDateISO("2024-01-15");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should handle empty date string", () => {
      const result = build.formatDateISO("");
      expect(result).toBe("");
    });
  });

  describe("validateArticle", () => {
    it("should validate complete article", () => {
      const article = {
        title: "Test Article",
        date: "2024-01-01",
        slug: "test-article",
        content:
          "This is a test article with enough content to pass validation and make it longer than one hundred characters so it does not trigger short content warning.",
        description: "A test article",
      };

      const result = build.validateArticle(article);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("should report missing title error", () => {
      const article = {
        date: "2024-01-01",
        slug: "test",
        content: "Content here",
      };

      expect(() => build.validateArticle(article)).toThrow(
        "Missing or empty title"
      );
    });

    it("should report missing date error", () => {
      const article = {
        title: "Test",
        slug: "test",
        content: "Content here",
      };

      expect(() => build.validateArticle(article)).toThrow("Missing date");
    });

    it("should report invalid date error", () => {
      const article = {
        title: "Test",
        date: "invalid-date",
        slug: "test",
        content: "Content here",
      };

      expect(() => build.validateArticle(article)).toThrow(
        "Invalid date format"
      );
    });

    it("should warn about future date", () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const article = {
        title: "Test",
        date: futureDate.toISOString().split("T")[0],
        slug: "test",
        content:
          "This is a test article with enough content to pass validation and avoid short content warning.",
        description: "Test",
      };

      const result = build.validateArticle(article);
      expect(result.warnings).toContain("Future date detected");
    });

    it("should warn about missing description", () => {
      const article = {
        title: "Test",
        date: "2024-01-01",
        slug: "test",
        content:
          "This is a test article with enough content to pass validation and avoid short content warning.",
      };

      const result = build.validateArticle(article);
      expect(result.warnings).toContain(
        "Missing description - recommended for SEO"
      );
    });

    it("should warn about short content", () => {
      const article = {
        title: "Test",
        date: "2024-01-01",
        slug: "test",
        content: "Short",
        description: "Test",
      };

      const result = build.validateArticle(article);
      expect(result.warnings).toContain("Content is very short");
    });
  });

  describe("escapeHtml", () => {
    it("should escape HTML special characters", () => {
      const input = '<script>alert("xss")</script> & "quotes" \'single\'';
      const expected =
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &#039;single&#039;";

      expect(build.escapeHtml(input)).toBe(expected);
    });

    it("should handle empty string", () => {
      expect(build.escapeHtml("")).toBe("");
    });

    it("should handle string without special characters", () => {
      const input = "Normal text";
      expect(build.escapeHtml(input)).toBe(input);
    });
  });

  describe("estimateReadingTime", () => {
    it("should estimate reading time for text content", () => {
      const words = Array(200).fill("word").join(" ");
      const result = build.estimateReadingTime(words);

      expect(result).toBe(1);
    });

    it("should handle HTML content", () => {
      const content = "<p>" + Array(200).fill("word").join(" ") + "</p>";
      const result = build.estimateReadingTime(content);

      expect(result).toBe(1);
    });

    it("should round up reading time", () => {
      const words = Array(250).fill("word").join(" ");
      const result = build.estimateReadingTime(words);

      expect(result).toBe(2);
    });

    it("should handle empty content", () => {
      const result = build.estimateReadingTime("");
      expect(result).toBe(1);
    });
  });

  describe("replaceTemplate", () => {
    it("should replace template placeholders", () => {
      const template = "Hello {{name}}, welcome to {{site}}!";
      const replacements = {
        name: "John",
        site: "My Blog",
      };

      const result = build.replaceTemplate(template, replacements);
      expect(result).toBe("Hello John, welcome to My Blog!");
    });

    it("should handle missing replacements", () => {
      const template = "Hello {{name}}, welcome to {{site}}!";
      const replacements = {
        name: "John",
      };

      const result = build.replaceTemplate(template, replacements);
      expect(result).toBe("Hello John, welcome to {{site}}!");
    });

    it("should handle empty replacements object", () => {
      const template = "Hello {{name}}!";
      const result = build.replaceTemplate(template, {});

      expect(result).toBe("Hello {{name}}!");
    });

    it("should handle template without placeholders", () => {
      const template = "Hello world!";
      const result = build.replaceTemplate(template, { name: "John" });

      expect(result).toBe("Hello world!");
    });
  });

  describe("sanitizeHtml", () => {
    it("should remove script tags", () => {
      const input = '<p>Safe content</p><script>alert("xss")</script>';
      const result = build.sanitizeHtml(input);

      expect(result).toBe("<p>Safe content</p>");
      expect(result).not.toContain("<script>");
    });

    it("should remove iframe tags", () => {
      const input = '<p>Content</p><iframe src="evil.com"></iframe>';
      const result = build.sanitizeHtml(input);

      expect(result).toBe("<p>Content</p>");
      expect(result).not.toContain("<iframe>");
    });

    it("should remove event handlers", () => {
      const input = '<button onclick="alert()">Click</button>';
      const result = build.sanitizeHtml(input);

      expect(result).toBe("<button >Click</button>");
      expect(result).not.toContain("onclick");
    });

    it("should remove javascript: and vbscript: protocols", () => {
      const input = '<a href="javascript:alert()">Link</a>';
      const result = build.sanitizeHtml(input);

      expect(result).not.toContain("javascript:");
    });

    it("should preserve safe HTML", () => {
      const input =
        '<p>Safe <strong>content</strong> with <a href="https://example.com">link</a></p>';
      const result = build.sanitizeHtml(input);

      expect(result).toBe(input);
    });
  });
});
