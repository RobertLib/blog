import { describe, expect, it } from "vitest";
import * as build from "../build.js";

describe("Blog Utils - Additional Tests", () => {
  describe("Template replacement logic", () => {
    it("should handle duplicate placeholders", () => {
      const template = "{{name}} said hello to {{name}} and {{name}} again";
      const replacements = { name: "John" };

      const result = build.replaceTemplate(template, replacements);

      expect(result).toBe("John said hello to John and John again");
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

  describe("HTML escaping edge cases", () => {
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

  describe("Content processing edge cases", () => {
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

  describe("HTML sanitization edge cases", () => {
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

  describe("Date handling edge cases", () => {
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

  describe("Metadata extraction edge cases", () => {
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
});
