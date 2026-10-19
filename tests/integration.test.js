import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
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

  // Runs the real build script in a temporary copy of the project, so the
  // actual dist/ is never touched
  describe("Full production build", () => {
    const PROJECT_FILES = [
      "articles",
      "templates",
      "static",
      "build.js",
      "config.js",
      "seo-validate.js",
      "html-entities.js",
    ];
    const tempDirs = [];

    function copyProject() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-build-"));
      tempDirs.push(dir);
      for (const entry of PROJECT_FILES) {
        fs.cpSync(entry, path.join(dir, entry), { recursive: true });
      }
      return dir;
    }

    function runBuild(dir) {
      return spawnSync(process.execPath, ["build.js"], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          BASE_URL: "https://example.com",
          // Dates must not shift when built west of UTC
          TZ: "America/New_York",
        },
      });
    }

    afterAll(() => {
      tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    });

    it("should generate every page and pass SEO validation", () => {
      const dir = copyProject();
      const result = runBuild(dir);
      const dist = path.join(dir, "dist");
      const read = (file) => fs.readFileSync(path.join(dist, file), "utf8");
      const articles = build.getAllArticles();

      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("all SEO checks passed");

      for (const file of [
        "index.html",
        "archive.html",
        "404.html",
        "sitemap.xml",
        "feed.xml",
        "styles.css",
        "fonts/inter-latin.woff2",
        ...articles.map((article) => article.filename),
      ]) {
        expect(fs.existsSync(path.join(dist, file)), file).toBe(true);
      }

      for (const article of articles) {
        const html = read(article.filename);
        const ld = html.match(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
        )[1];

        expect(JSON.parse(ld).headline).toBe(article.title);
        expect(html).toContain(build.formatDate(article.date));
        expect(html.slice(0, html.indexOf("</head>"))).not.toMatch(
          /\{\{[^}]+\}\}/
        );
      }

      const sitemap = read("sitemap.xml");
      const feed = read("feed.xml");
      for (const article of articles) {
        expect(sitemap).toContain(
          `<loc>https://example.com/${article.filename}</loc>`
        );
      }
      expect(feed.match(/<item>/g)).toHaveLength(Math.min(articles.length, 10));

      const pages = fs
        .readdirSync(dist)
        .filter((file) => /\.(html|xml)$/.test(file));
      for (const file of pages) {
        expect(read(file), file).not.toContain("localhost");
      }
    });

    it("should fail when an article is invalid", () => {
      const dir = copyProject();
      fs.writeFileSync(
        path.join(dir, "articles", "broken-article.html"),
        "<!-- title: Broken -->\n<!-- date: 2024-01-01 -->\n<p>No description.</p>"
      );

      const result = runBuild(dir);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("broken-article.html");
      expect(result.stderr).toContain("Missing description");
    });
  });
});
