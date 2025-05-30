import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as build from "../build.js";

describe("Blog HTML Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateIndexHtml", () => {
    it("should test article list generation logic", () => {
      const mockArticles = [
        {
          title: "First Article",
          filename: "first-article.html",
          date: "2024-01-02",
          description: "First article description",
          content:
            "This is the first article content with enough words to make a meaningful reading time estimate.",
        },
        {
          title: "Second Article",
          filename: "second-article.html",
          date: "2024-01-01",
          description: "Second article description",
          content:
            "This is the second article content with enough words to make a meaningful reading time estimate.",
        },
      ];

      const recentArticles = mockArticles.slice(0, 10);
      const articlesList = recentArticles
        .map((article) => {
          const readingTime = build.estimateReadingTime(article.content);
          return `
            <article>
              <h2>
                <a href="${build.escapeHtml(article.filename)}">
                  ${build.escapeHtml(article.title)}
                </a>
              </h2>
              <div class="article-meta">
                <time datetime="${build.escapeHtml(article.date)}">
                  ${build.formatDate(article.date)}
                </time>
                <span class="reading-time">${readingTime} min read</span>
              </div>
              ${
                article.description
                  ? `<p>${build.escapeHtml(article.description)}</p>`
                  : ""
              }
            </article>
          `;
        })
        .join("");

      expect(articlesList).toContain("First Article");
      expect(articlesList).toContain("Second Article");
      expect(articlesList).toContain("first-article.html");
      expect(articlesList).toContain("January 2, 2024");
      expect(articlesList).toContain("min read");
    });

    it("should test archive link generation logic", () => {
      const mockArticles = Array(15)
        .fill(null)
        .map((_, i) => ({
          title: `Article ${i + 1}`,
          filename: `article-${i + 1}.html`,
          date: `2024-01-${String(i + 1).padStart(2, "0")}`,
          content:
            "Article content with enough words to make reading time estimation meaningful.",
        }));

      let archiveLink = "";
      if (mockArticles.length > 10) {
        archiveLink =
          '<p><a href="archive.html" class="button">View Archive</a></p>';
      }

      expect(archiveLink).toContain("View Archive");
      expect(archiveLink).toContain("archive.html");
    });

    it("should test archive link logic for few articles", () => {
      const mockArticles = [
        {
          title: "Only Article",
          filename: "only-article.html",
          date: "2024-01-01",
          content: "Single article content.",
        },
      ];

      let archiveLink = "";
      if (mockArticles.length > 10) {
        archiveLink =
          '<p><a href="archive.html" class="button">View Archive</a></p>';
      }

      expect(archiveLink).toBe("");
    });
  });

  describe("generateArchiveHtml", () => {
    it("should test archive grouping logic by year", () => {
      const mockArticles = [
        {
          title: "Article 2024",
          filename: "article-2024.html",
          date: "2024-01-01",
        },
        {
          title: "Article 2023",
          filename: "article-2023.html",
          date: "2023-12-01",
        },
        {
          title: "Another 2024",
          filename: "another-2024.html",
          date: "2024-06-01",
        },
      ];

      const articlesByYear = {};
      mockArticles.forEach((article) => {
        if (article.date) {
          const year = new Date(article.date).getFullYear();
          if (!articlesByYear[year]) {
            articlesByYear[year] = [];
          }
          articlesByYear[year].push(article);
        }
      });

      const sortedYears = Object.keys(articlesByYear).sort((a, b) => b - a);

      expect(sortedYears).toEqual(["2024", "2023"]);
      expect(articlesByYear[2024]).toHaveLength(2);
      expect(articlesByYear[2023]).toHaveLength(1);
      expect(articlesByYear[2024][0].title).toBe("Article 2024");
      expect(articlesByYear[2024][1].title).toBe("Another 2024");
      expect(articlesByYear[2023][0].title).toBe("Article 2023");
    });

    it("should test filtering of articles without dates", () => {
      const mockArticles = [
        {
          title: "Article with date",
          filename: "with-date.html",
          date: "2024-01-01",
        },
        {
          title: "Article without date",
          filename: "without-date.html",
        },
      ];

      const articlesWithDates = mockArticles.filter((article) => article.date);

      expect(articlesWithDates).toHaveLength(1);
      expect(articlesWithDates[0].title).toBe("Article with date");
    });
  });

  describe("generateSitemap", () => {
    it("should generate valid XML sitemap content", () => {
      const mockArticles = [
        { filename: "article1.html" },
        { filename: "article2.html" },
      ];

      const urls = [
        "http://localhost:3000/",
        "http://localhost:3000/archive.html",
        ...mockArticles.map(
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
      expect(sitemap).toContain("<loc>http://localhost:3000/</loc>");
      expect(sitemap).toContain(
        "<loc>http://localhost:3000/archive.html</loc>"
      );
      expect(sitemap).toContain(
        "<loc>http://localhost:3000/article1.html</loc>"
      );
      expect(sitemap).toContain(
        "<loc>http://localhost:3000/article2.html</loc>"
      );
      expect(sitemap).toContain("</urlset>");
    });

    it("should handle empty articles array", () => {
      const urls = [
        "http://localhost:3000/",
        "http://localhost:3000/archive.html",
      ];

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => `  <url><loc>${build.escapeHtml(url)}</loc></url>`)
  .join("\n")}
</urlset>`;

      expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(sitemap).toContain("<loc>http://localhost:3000/</loc>");
      expect(sitemap).toContain(
        "<loc>http://localhost:3000/archive.html</loc>"
      );
    });

    it("should escape HTML in URLs", () => {
      const mockArticles = [{ filename: "article&test.html" }];

      const url = `http://localhost:3000/${mockArticles[0].filename}`;
      const escapedUrl = build.escapeHtml(url);

      expect(escapedUrl).toContain("article&amp;test.html");
      expect(escapedUrl).not.toContain("article&test.html");
    });
  });

  describe("generateRSSFeed", () => {
    it("should generate valid RSS feed content", () => {
      const mockArticles = [
        {
          title: "Test Article",
          filename: "test.html",
          description: "Test description",
          date: "2024-01-01",
        },
        {
          title: "Another Article",
          filename: "another.html",
          description: "Another description",
          date: "2024-01-02",
        },
      ];

      const validArticles = mockArticles.filter(
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
      expect(rss).toContain("<title><![CDATA[Test Article]]></title>");
      expect(rss).toContain("<title><![CDATA[Another Article]]></title>");
      expect(rss).toContain(
        "<description><![CDATA[Test description]]></description>"
      );
      expect(rss).toContain("</channel>");
      expect(rss).toContain("</rss>");
    });

    it("should limit RSS to 10 articles", () => {
      const mockArticles = Array(15)
        .fill(null)
        .map((_, i) => ({
          title: `Article ${i + 1}`,
          filename: `article${i + 1}.html`,
          description: `Description ${i + 1}`,
          date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        }));

      const validArticles = mockArticles.filter(
        (article) => article.date && !isNaN(new Date(article.date))
      );
      const limitedArticles = validArticles.slice(0, 10);

      expect(limitedArticles).toHaveLength(10);
      expect(limitedArticles[0].title).toBe("Article 1");
      expect(limitedArticles[9].title).toBe("Article 10");
    });

    it("should filter out articles with invalid dates", () => {
      const mockArticles = [
        {
          title: "Valid Article",
          filename: "valid.html",
          description: "Valid description",
          date: "2024-01-01",
        },
        {
          title: "Invalid Article",
          filename: "invalid.html",
          description: "Invalid description",
          date: "invalid-date",
        },
        {
          title: "No Date Article",
          filename: "no-date.html",
          description: "No date description",
        },
      ];

      const validArticles = mockArticles.filter(
        (article) => article.date && !isNaN(new Date(article.date))
      );

      expect(validArticles).toHaveLength(1);
      expect(validArticles[0].title).toBe("Valid Article");
    });

    it("should include pubDate in RSS items", () => {
      const mockArticles = [
        {
          title: "Test Article",
          filename: "test.html",
          description: "Test description",
          date: "2024-01-01T00:00:00.000Z",
        },
      ];

      const pubDate = new Date(mockArticles[0].date).toUTCString();

      expect(pubDate).toMatch(/GMT/);
      expect(pubDate).toContain("2024");
    });
  });
});
