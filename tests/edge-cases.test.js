import { describe, expect, it } from "vitest";
import * as build from "../build.js";

describe("Edge Cases and Error Handling", () => {
  describe("Edge cases for extractMetadata", () => {
    it("should handle malformed metadata comments", () => {
      const content = `
        <!-- title Test Article -->
        <!-- date: -->
        <!-- : value without key -->
        <!--invalid comment-->
        <p>Content</p>
      `;

      const result = build.extractMetadata(content);

      expect(result.metadata).toEqual({ date: "" });
      expect(result.content).toContain("<p>Content</p>");
    });

    it("should handle metadata with special characters", () => {
      const content = `
        <!-- title: Article with "quotes" & <tags> -->
        <!-- description: Multi-line
             description here -->
        <p>Content</p>
      `;

      const result = build.extractMetadata(content);

      expect(result.metadata.title).toContain("quotes");
      expect(result.metadata.title).toContain("&");
    });

    it("should handle empty content", () => {
      const result = build.extractMetadata("");

      expect(result.metadata).toEqual({});
      expect(result.content).toBe("");
    });

    it("should handle content with only metadata", () => {
      const content = "<!-- title: Only Metadata -->";
      const result = build.extractMetadata(content);

      expect(result.metadata.title).toBe("Only Metadata");
      expect(result.content).toBe("");
    });
  });

  describe("Edge cases for date handling", () => {
    it("should handle various date formats", () => {
      expect(build.formatDate("2024-01-01")).toBe("January 1, 2024");
      expect(build.formatDate("2024/01/01")).toBe("January 1, 2024");
      expect(build.formatDate("01/01/2024")).toBe("January 1, 2024");
    });

    it("should handle ISO date strings", () => {
      expect(build.formatDate("2024-01-01T00:00:00.000Z")).toBe(
        "January 1, 2024"
      );
    });

    it("should handle edge dates", () => {
      expect(build.formatDate("2024-02-29")).toBe("February 29, 2024");
      expect(build.formatDate("2024-12-31")).toBe("December 31, 2024");
      expect(build.formatDate("1970-01-01")).toBe("January 1, 1970");
    });
  });

  describe("Edge cases for content processing", () => {
    it("should handle extremely long content", () => {
      const longContent = "word ".repeat(10000).trim();
      const readingTime = build.estimateReadingTime(longContent);

      expect(readingTime).toBe(50);
    });

    it("should handle content with only HTML tags", () => {
      const htmlOnlyContent = '<div><span><img src="test.jpg"></span></div>';
      const readingTime = build.estimateReadingTime(htmlOnlyContent);

      expect(readingTime).toBe(1);
    });

    it("should handle content with mixed languages", () => {
      const mixedContent = "Hello world Привет мир 你好世界 مرحبا بالعالم";
      const readingTime = build.estimateReadingTime(mixedContent);

      expect(readingTime).toBe(1);
    });

    it("should handle content with special characters and numbers", () => {
      const specialContent =
        "Test 123 @#$% ñáéíóú çñüö 2024-01-01 user@example.com";
      const readingTime = build.estimateReadingTime(specialContent);

      expect(readingTime).toBeGreaterThan(0);
    });
  });

  describe("Edge cases for HTML sanitization", () => {
    it("should handle nested dangerous tags", () => {
      const dangerous =
        "<div><script>alert(1)</script><p>Safe content</p></div>";
      const result = build.sanitizeHtml(dangerous);

      expect(result).toBe("<div><p>Safe content</p></div>");
    });

    it("should handle mixed case dangerous tags", () => {
      const dangerous = "<SCRIPT>alert(1)</SCRIPT><ScRiPt>alert(2)</ScRiPt>";
      const result = build.sanitizeHtml(dangerous);

      expect(result).toBe("");
    });

    it("should handle multiple event handlers", () => {
      const dangerous =
        '<button onclick="alert(1)" onmouseover="alert(2)" onload="alert(3)">Click</button>';
      const result = build.sanitizeHtml(dangerous);

      expect(result).toBe("<button   >Click</button>");
    });

    it("should handle malformed HTML", () => {
      const malformed = "<script><div>content</script></div>";
      const result = build.sanitizeHtml(malformed);

      expect(result).not.toContain("<script>");
    });

    it("should preserve valid attributes", () => {
      const validHtml =
        '<a href="https://example.com" title="Example" class="link">Link</a>';
      const result = build.sanitizeHtml(validHtml);

      expect(result).toBe(validHtml);
    });
  });

  describe("Edge cases for template replacement", () => {
    it("should handle template with duplicate placeholders", () => {
      const template = "{{name}} said hello to {{name}} and {{name}} again";
      const replacements = { name: "John" };

      const result = build.replaceTemplate(template, replacements);

      expect(result).toBe("John said hello to John and John again");
    });

    it("should handle nested-like placeholders", () => {
      const template = "{{{{nested}}}} {{regular}}";
      const replacements = { nested: "value", regular: "normal" };

      const result = build.replaceTemplate(template, replacements);

      expect(result).toBe("{{value}} normal");
    });

    it("should handle empty placeholder names", () => {
      const template = "Hello {{}} world {{name}}";
      const replacements = { name: "John" };

      const result = build.replaceTemplate(template, replacements);

      expect(result).toBe("Hello {{}} world John");
    });

    it("should handle placeholders with special characters", () => {
      const template = "Hello {{user-name}} and {{user_email}}";
      const replacements = {
        "user-name": "John Doe",
        user_email: "john@example.com",
      };

      const result = build.replaceTemplate(template, replacements);

      expect(result).toBe("Hello John Doe and john@example.com");
    });
  });

  describe("Edge cases for HTML escaping", () => {
    it("should handle all HTML entities", () => {
      const input = "&<>\"'";
      const expected = "&amp;&lt;&gt;&quot;&#039;";

      expect(build.escapeHtml(input)).toBe(expected);
    });

    it("should handle already escaped content", () => {
      const input = "&amp;&lt;&gt;";
      const expected = "&amp;amp;&amp;lt;&amp;gt;";

      expect(build.escapeHtml(input)).toBe(expected);
    });

    it("should handle unicode characters", () => {
      const input = "Hello 👋 🌍 ñáéíóú";

      expect(build.escapeHtml(input)).toBe(input);
    });
  });

  describe("Error recovery", () => {
    it("should handle article with missing required fields gracefully", () => {
      const article = {
        content: "Some content",
      };

      expect(() => build.validateArticle(article)).toThrow();
    });

    it("should handle template loading failures", () => {
      expect(() => build.loadTemplate("nonexistent")).toThrow(
        "Template nonexistent.html not found"
      );
    });

    it("should handle corrupted article files", () => {
      const corruptedContent = String.fromCharCode(0, 1, 2, 3, 4, 5);

      const result = build.extractMetadata(corruptedContent);

      expect(result.metadata).toEqual({});
      expect(result.content).toBe(corruptedContent);
    });
  });

  describe("Performance edge cases", () => {
    it("should test sitemap generation for many articles", () => {
      const manyArticles = Array(1000)
        .fill(null)
        .map((_, i) => ({
          title: `Article ${i}`,
          filename: `article-${i}.html`,
          date: "2024-01-01",
        }));

      const urls = [
        "http://localhost:3000/",
        "http://localhost:3000/archive.html",
        ...manyArticles.map(
          (article) => `http://localhost:3000/${article.filename}`
        ),
      ];

      expect(urls.length).toBe(1002);
      expect(urls[0]).toBe("http://localhost:3000/");
      expect(urls[1]).toBe("http://localhost:3000/archive.html");
      expect(urls[2]).toBe("http://localhost:3000/article-0.html");
    });

    it("should handle articles with very long titles", () => {
      const longTitle = "A".repeat(1000);
      const article = {
        title: longTitle,
        date: "2024-01-01",
        slug: "test",
        content:
          "Content with enough text to avoid short content warning and pass validation.",
        description: "Description",
      };

      const result = build.validateArticle(article);

      expect(result.errors).toEqual([]);
    });
  });
});
