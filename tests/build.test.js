import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
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

    it("should read metadata only from the top of the file", () => {
      const content = `<!-- title: Real Title -->
<!-- date: 2024-01-01 -->

<p>Body</p>
<!-- title: Not metadata -->
<!-- todo: rewrite this -->`;
      const result = build.extractMetadata(content);

      expect(result.metadata).toEqual({
        title: "Real Title",
        date: "2024-01-01",
      });
      expect(result.content).toBe(
        "<p>Body</p>\n<!-- title: Not metadata -->\n<!-- todo: rewrite this -->"
      );
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

    it.each(["index", "archive", "projects", "404"])(
      "should reject an article named %s.html, a page the build generates",
      (slug) => {
        const article = {
          title: "Test Article",
          date: "2024-01-01",
          slug,
          content: "<p>Content</p>",
          description: "A test article",
        };

        expect(() => build.validateArticle(article)).toThrow(
          `File name ${slug}.html is taken`
        );
      }
    );

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

    it("should reject a date in the future", () => {
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

      expect(() => build.validateArticle(article)).toThrow(/in the future/);
    });

    it("should accept today's date in any time zone", () => {
      // Tomorrow in UTC is already today east of UTC+10
      const soon = new Date(Date.now() + 10 * 60 * 60 * 1000);
      const article = {
        title: "Test",
        date: soon.toISOString().split("T")[0],
        slug: "test",
        content:
          "This is a test article with enough content to pass validation and avoid short content warning.",
        description: "Test",
      };

      expect(() => build.validateArticle(article)).not.toThrow();
    });

    it("should reject missing description", () => {
      const article = {
        title: "Test",
        date: "2024-01-01",
        slug: "test",
        content:
          "This is a test article with enough content to pass validation and avoid short content warning.",
      };

      expect(() => build.validateArticle(article)).toThrow(
        "Missing description"
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

    it("should not touch prose or code that mentions handlers", () => {
      const input =
        '<p>Set options = "a" and use javascript: links; onload="x" in text</p>';

      expect(build.sanitizeHtml(input)).toBe(input);
    });

    it("should keep URLs that merely contain javascript:", () => {
      const input =
        '<a href="https://example.com/javascript:the-good-parts" title="JavaScript: The Good Parts">Book</a>';

      expect(build.sanitizeHtml(input)).toBe(input);
    });

    it("should remove script URLs hidden with entities or whitespace", () => {
      for (const href of [
        "jav&#x09;ascript:alert(1)",
        "javascript&colon;alert(1)",
        " JavaScript:alert(1)",
        "vbscript:msgbox(1)",
      ]) {
        expect(build.sanitizeHtml(`<a href="${href}">x</a>`)).toBe("<a >x</a>");
      }
    });

    it("should not end a tag at a > inside a quoted value", () => {
      const input = '<a title="a > b" onclick="alert(1)" href="/x">x</a>';

      expect(build.sanitizeHtml(input)).toBe('<a title="a > b"  href="/x">x</a>');
    });

    it("should remove unquoted event handlers", () => {
      const input = "<img src=x.png onerror=alert(1)>";

      expect(build.sanitizeHtml(input)).toBe("<img src=x.png >");
    });
  });

  describe("replaceTemplate with code-like values", () => {
    it("should not interpret $ replacement patterns in values", () => {
      const template = "<div>{{content}}</div>";
      const content = "<code>s.replace(re, \"$&-$'-$`-$1\")</code>";

      expect(build.replaceTemplate(template, { content })).toBe(
        `<div>${content}</div>`
      );
    });

    it("should not replace placeholders inside substituted values", () => {
      const template = "{{content}} {{year}}";
      const content = "<code>{{year}} {{content}}</code>";

      expect(build.replaceTemplate(template, { content, year: 2026 })).toBe(
        "<code>{{year}} {{content}}</code> 2026"
      );
    });

    it("should keep numeric zero values", () => {
      expect(build.replaceTemplate("{{n}}", { n: 0 })).toBe("0");
    });
  });

  describe("stripHtml and countWords", () => {
    it("should drop tags and decode entities", () => {
      expect(build.stripHtml("<p>Don&rsquo;t&nbsp;panic &amp; code</p>").trim())
        .toBe("Don’t panic & code");
    });

    it("should drop unknown entities, including ones with digits", () => {
      expect(build.countWords("<p>Add &frac12; cup &hearts;</p>")).toBe(2);
    });

    // A browser shows U+FFFD; String.fromCodePoint would throw and fail the
    // whole build
    it("should survive numeric references to no valid character", () => {
      expect(
        build.stripHtml("<p>&#99999999;&#x110000;&#xD800;&#0;&#65;</p>").trim()
      ).toBe("����A");
    });

    it("should count only visible words", () => {
      expect(
        build.countWords('<p class="lead">One <strong>two</strong> three</p>')
      ).toBe(3);
      expect(build.countWords("")).toBe(0);
    });
  });

  describe("extractKeywords", () => {
    it("should ignore HTML tag and attribute names", () => {
      const content = `
        <p><strong>Rust</strong> and <a href="#">Rust</a> compilers</p>
        <blockquote><p><strong>Compilers</strong> matter</p></blockquote>
      `;
      const keywords = build.extractKeywords(content, "Rust compilers");

      expect(keywords.split(", ")).toEqual(
        expect.arrayContaining(["rust", "compilers"])
      );
      expect(keywords).not.toMatch(/\b(strong|href|blockquote)\b/);
    });
  });

  describe("escapeJsonString", () => {
    it("should produce a valid JSON string body without HTML entities", () => {
      const value = `RobLib's "Blog" \\ </script>`;
      const escaped = build.escapeJsonString(value);

      expect(escaped).not.toContain("</script>");
      expect(JSON.parse(`"${escaped}"`)).toBe(value);
    });
  });

  describe("getAllArticles", () => {
    let dir;
    const valid = `<!-- title: Valid -->
<!-- date: 2024-01-01 -->
<!-- description: Valid description -->
<p>${"Enough content to avoid the short content warning. ".repeat(3)}</p>`;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-articles-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("should fail on an invalid article instead of skipping it", () => {
      fs.writeFileSync(path.join(dir, "valid.html"), valid);
      fs.writeFileSync(
        path.join(dir, "broken.html"),
        valid.replace("2024-01-01", "not-a-date")
      );

      expect(() => build.getAllArticles(dir)).toThrow(/broken\.html/);
    });

    it("should return valid articles", () => {
      fs.writeFileSync(path.join(dir, "valid.html"), valid);

      const articles = build.getAllArticles(dir);
      expect(articles.map((a) => a.slug)).toEqual(["valid"]);
    });
  });
});
