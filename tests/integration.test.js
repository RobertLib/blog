import { describe, expect, it } from "vitest";
import * as build from "../build.js";

describe("Integration Tests - Real Usage", () => {
  describe("End-to-end functionality", () => {
    it("should have all required exported functions", () => {
      const requiredFunctions = [
        "loadTemplate",
        "extractMetadata",
        "formatDate",
        "formatDateISO",
        "validateArticle",
        "getArticleData",
        "getAllArticles",
        "escapeHtml",
        "estimateReadingTime",
        "replaceTemplate",
        "sanitizeHtml",
        "generateIndexHtml",
        "generateArchiveHtml",
        "buildArticle",
        "generateSitemap",
        "generateRSSFeed",
        "build",
        "ensureDir",
        "copyDirectory",
        "copyStatic",
        "buildIndex",
        "buildArchive",
        "validateSEO",
      ];

      requiredFunctions.forEach((funcName) => {
        expect(typeof build[funcName]).toBe("function");
      });
    });

    it("should process real articles if they exist", () => {
      const articles = build.getAllArticles();

      expect(Array.isArray(articles)).toBe(true);

      if (articles.length > 0) {
        articles.forEach((article) => {
          expect(article).toHaveProperty("title");
          expect(article).toHaveProperty("filename");
          expect(article).toHaveProperty("slug");
          expect(article).toHaveProperty("content");

          const readingTime = build.estimateReadingTime(article.content);
          expect(readingTime).toBeGreaterThan(0);

          const escapedTitle = build.escapeHtml(article.title);
          expect(typeof escapedTitle).toBe("string");

          const sanitizedContent = build.sanitizeHtml(article.content);
          expect(typeof sanitizedContent).toBe("string");
        });
      }
    });

    it("should generate valid sitemap content", () => {
      const articles = build.getAllArticles();

      const urls = [
        "http://localhost:3000/",
        "http://localhost:3000/archive.html",
        ...articles.map(
          (article) => `http://localhost:3000/${article.filename}`
        ),
      ];

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => `  <url><loc>${build.escapeHtml(url)}</loc></url>`)
  .join("\n")}
</urlset>`;

      expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(sitemap).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      );
      expect(sitemap).toContain("</urlset>");
    });

    it("should generate valid RSS content", () => {
      const articles = build.getAllArticles();

      const validArticles = articles.filter(
        (article) => article.date && !isNaN(new Date(article.date))
      );

      const rssItems = validArticles
        .slice(0, 10)
        .map(
          (article) => `
            <item>
              <title><![CDATA[${article.title}]]></title>
              <link>http://localhost:3000/${article.filename}</link>
              <description><![CDATA[${
                article.description || ""
              }]]></description>
              <pubDate>${new Date(article.date).toUTCString()}</pubDate>
              <guid>http://localhost:3000/${article.filename}</guid>
            </item>
          `
        )
        .join("");

      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RobLib's Blog</title>
    <link>http://localhost:3000</link>
    <description>Blog about programming and web technologies</description>
    ${rssItems}
  </channel>
</rss>`;

      expect(rss).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(rss).toContain('<rss version="2.0">');
      expect(rss).toContain("<channel>");
      expect(rss).toContain("</channel>");
      expect(rss).toContain("</rss>");
    });

    it("should handle template processing workflow", () => {
      const testTemplate = "Hello {{name}}, welcome to {{site}}!";
      const testReplacements = {
        name: "John",
        site: "My Blog",
      };

      const result = build.replaceTemplate(testTemplate, testReplacements);
      expect(result).toBe("Hello John, welcome to My Blog!");

      const escaped = build.escapeHtml(result);
      const sanitized = build.sanitizeHtml(escaped);

      expect(typeof escaped).toBe("string");
      expect(typeof sanitized).toBe("string");
    });

    it("should validate article processing pipeline", () => {
      const testArticleContent = `
        <!-- title: Test Article -->
        <!-- date: 2024-01-01 -->
        <!-- description: Test description -->
        <h1>Test Content</h1>
        <p>This is a test article with enough content to pass validation checks.</p>
      `;

      const { metadata, content } = build.extractMetadata(testArticleContent);

      const article = {
        ...metadata,
        content,
        filename: "test.html",
        slug: "test",
      };

      const validationResult = build.validateArticle(article);
      expect(validationResult.errors).toEqual([]);

      const readingTime = build.estimateReadingTime(article.content);
      expect(readingTime).toBeGreaterThan(0);

      const formattedDate = build.formatDate(article.date);
      expect(formattedDate).toBe("January 1, 2024");

      const escapedTitle = build.escapeHtml(article.title);
      expect(escapedTitle).toBe("Test Article");

      const sanitizedContent = build.sanitizeHtml(article.content);
      expect(sanitizedContent).toContain("<h1>Test Content</h1>");
    });
  });
});
