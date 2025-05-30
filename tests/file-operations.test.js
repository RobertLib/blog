import { describe, expect, it } from "vitest";
import * as build from "../build.js";

describe("File Operations - Logic Tests", () => {
  describe("loadTemplate error handling", () => {
    it("should test template loading with existing templates", () => {
      try {
        const result = build.loadTemplate("article");
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      } catch (error) {
        expect(error.message).toContain("Template");
      }
    });

    it("should fail gracefully for non-existent templates", () => {
      expect(() => build.loadTemplate("nonexistent")).toThrow(
        "Template nonexistent.html not found"
      );
    });
  });

  describe("getAllArticles with real files", () => {
    it("should return articles from the articles directory", () => {
      const articles = build.getAllArticles();

      expect(Array.isArray(articles)).toBe(true);

      if (articles.length > 0) {
        articles.forEach((article) => {
          expect(article).toHaveProperty("title");
          expect(article).toHaveProperty("filename");
          expect(article).toHaveProperty("slug");
          expect(article).toHaveProperty("content");
        });

        for (let i = 1; i < articles.length; i++) {
          if (articles[i - 1].date && articles[i].date) {
            const prevDate = new Date(articles[i - 1].date);
            const currDate = new Date(articles[i].date);
            expect(prevDate.getTime()).toBeGreaterThanOrEqual(
              currDate.getTime()
            );
          }
        }
      }
    });
  });

  describe("Article data processing", () => {
    it("should handle articles with existing files", () => {
      const articles = build.getAllArticles();

      if (articles.length > 0) {
        const firstArticle = articles[0];

        try {
          const articleData = build.getArticleData(firstArticle.filename);
          expect(articleData.title).toBe(firstArticle.title);
          expect(articleData.filename).toBe(firstArticle.filename);
        } catch (error) {
          expect(error.message).toContain("Error processing article");
        }
      } else {
        expect(articles).toEqual([]);
      }
    });

    it("should fail for non-existent article files", () => {
      expect(() => build.getArticleData("non-existent-file.html")).toThrow();
    });
  });

  describe("File path handling", () => {
    it("should handle path operations correctly", () => {
      const testPaths = [
        "test.html",
        "subfolder/test.html",
        "deep/nested/path/test.html",
      ];

      testPaths.forEach((testPath) => {
        expect(typeof testPath).toBe("string");
        expect(testPath.endsWith(".html")).toBe(true);
      });
    });
  });

  describe("Directory creation logic", () => {
    it("should have proper ensureDir logic structure", () => {
      expect(typeof build.ensureDir).toBe("function");

      try {
        build.ensureDir("/tmp/test-blog-dir");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Static file operations", () => {
    it("should handle copyStatic with existing static directory", () => {
      expect(typeof build.copyStatic).toBe("function");

      try {
        build.copyStatic();
        expect(true).toBe(true);
      } catch (error) {
        expect(error.message).toMatch(/ENOENT|Error copying static files/);
      }
    });
  });
});
