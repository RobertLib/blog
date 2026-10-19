import { describe, expect, it } from "vitest";
import os from "os";
import * as build from "../build.js";
import config from "../config.js";

const BASE_URL = config.site.baseUrl;

const jsonLd = (html) =>
  JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
  );

const head = (html) => html.slice(0, html.indexOf("</head>"));

function makeArticle(overrides = {}) {
  const slug = overrides.slug || "test-article";
  return {
    title: "Test Article",
    date: "2024-01-15",
    description: "A test description",
    content: "<p>Rust compilers are fast. Rust compilers matter.</p>",
    slug,
    filename: `${slug}.html`,
    ...overrides,
  };
}

// Runs fn with process.env.TZ set, restoring the previous zone afterwards
function inTimeZone(timeZone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe("Blog HTML Generation", () => {
  describe("date formatting", () => {
    it("should format dates independently of the local time zone", () => {
      for (const zone of ["UTC", "America/New_York", "Pacific/Auckland"]) {
        inTimeZone(zone, () => {
          expect(build.formatDate("2026-10-19")).toBe("October 19, 2026");
          expect(build.formatDateShort("2026-01-01")).toBe("Jan 1, 2026");
          expect(build.formatDate("2026/01/01")).toBe("January 1, 2026");
          expect(build.formatDate("01/31/2026")).toBe("January 31, 2026");
        });
      }
    });

    it("should parse date-only strings as UTC calendar days", () => {
      expect(build.parseDate("2024/3/9").toISOString()).toBe(
        "2024-03-09T00:00:00.000Z"
      );
      expect(build.parseDate("2024-02-30").getTime()).toBeNaN();
      expect(build.parseDate("not a date").getTime()).toBeNaN();
      expect(build.parseDate("2024-01-01T12:30:00Z").toISOString()).toBe(
        "2024-01-01T12:30:00.000Z"
      );
    });
  });

  describe("generateIndexHtml", () => {
    it("should list articles with escaped titles and descriptions", () => {
      const html = build.generateIndexHtml([
        makeArticle({ slug: "newer", title: "Tom & Jerry <3" }),
        makeArticle({ slug: "older", description: "Quotes \"here\"" }),
      ]);

      expect(html).toContain('href="newer.html"');
      expect(html).toContain("Tom &amp; Jerry &lt;3");
      expect(html).toContain("Quotes &quot;here&quot;");
      expect(html.indexOf("newer.html")).toBeLessThan(
        html.indexOf("older.html")
      );
      expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it("should link to the archive only when articles overflow", () => {
      const count = config.build.recentArticlesCount;
      const articles = (n) =>
        Array.from({ length: n }, (_, i) => makeArticle({ slug: `a${i}` }));

      expect(build.generateIndexHtml(articles(count))).not.toContain(
        "View archive"
      );
      const overflowing = build.generateIndexHtml(articles(count + 1));
      expect(overflowing).toContain("View archive");
      expect(overflowing).not.toContain(`a${count}.html`);
    });

    it("should fill author and JSON-LD from config", () => {
      const html = build.generateIndexHtml([makeArticle()]);

      expect(jsonLd(html).author.name).toBe(config.site.author);
      expect(html).toContain(`content="${config.site.author}"`);
    });
  });

  describe("generateArchiveHtml", () => {
    it("should group articles by year, newest year first", () => {
      const html = build.generateArchiveHtml([
        makeArticle({ slug: "b", date: "2024-06-01" }),
        makeArticle({ slug: "a", date: "2024-01-01" }),
        makeArticle({ slug: "c", date: "2023-12-01" }),
      ]);

      const year2024 = html.indexOf(">2024</h2>");
      const year2023 = html.indexOf(">2023</h2>");
      expect(year2024).toBeGreaterThan(-1);
      expect(year2023).toBeGreaterThan(year2024);
      expect(html.indexOf('href="a.html"')).toBeLessThan(year2023);
      expect(html.indexOf('href="c.html"')).toBeGreaterThan(year2023);
    });

    it("should keep New Year articles in their year in any time zone", () => {
      const html = inTimeZone("America/New_York", () =>
        build.generateArchiveHtml([makeArticle({ date: "2026-01-01" })])
      );

      expect(html).toContain(">2026</h2>");
      expect(html).not.toContain(">2025</h2>");
    });
  });

  describe("renderArticleHtml", () => {
    const article = makeArticle({
      title: `RobLib's "Quoted" & <Tagged>`,
      modified: "2024-03-01T10:00:00.000Z",
      content: "<p>One <strong>two</strong> three</p>",
    });
    const older = makeArticle({ slug: "older", date: "2023-01-01" });
    const newer = makeArticle({ slug: "newer", date: "2025-01-01" });
    const html = build.renderArticleHtml(article, [newer, article, older]);

    it("should produce valid JSON-LD with unescaped text", () => {
      const data = jsonLd(html);

      expect(data.headline).toBe(article.title);
      expect(data.wordCount).toBe(3);
      expect(data.datePublished).toBe("2024-01-15T00:00:00.000Z");
      expect(data.dateModified).toBe(article.modified);
      expect(data.author.name).toBe(config.site.author);
      expect(data.image.url).toBe(`${BASE_URL}/og-image.png`);
    });

    it("should HTML-escape the title in markup", () => {
      expect(html).toContain(
        "<title>RobLib&#039;s &quot;Quoted&quot; &amp; &lt;Tagged&gt; - "
      );
    });

    it("should URL-encode share links", () => {
      const canonical = encodeURIComponent(`${BASE_URL}/${article.filename}`);

      expect(html).toContain(
        `tweet?url=${canonical}&amp;text=${encodeURIComponent(article.title)}`
      );
      expect(html).toContain(`share-offsite/?url=${canonical}"`);
    });

    it("should link previous and next articles by date", () => {
      const nav = html.slice(html.indexOf('class="post-nav"'));

      expect(nav).toMatch(/post-nav__item--prev" href="older\.html"/);
      expect(nav).toMatch(/post-nav__item--next" href="newer\.html"/);
    });

    it("should leave no template placeholders in the head", () => {
      expect(head(html)).not.toMatch(/\{\{[^}]+\}\}/);
      expect(html).toContain(
        `<meta property="article:modified_time" content="${article.modified}" />`
      );
    });
  });

  describe("renderSitemap", () => {
    const articles = [
      makeArticle({ slug: "edited", modified: "2025-05-05T08:00:00.000Z" }),
      makeArticle({ slug: "untouched", date: "2024-02-02" }),
    ];
    const sitemap = build.renderSitemap(articles);

    it("should use modification dates for articles", () => {
      expect(sitemap).toContain(
        `<loc>${BASE_URL}/edited.html</loc>\n    <lastmod>2025-05-05</lastmod>`
      );
      expect(sitemap).toContain(
        `<loc>${BASE_URL}/untouched.html</loc>\n    <lastmod>2024-02-02</lastmod>`
      );
    });

    it("should date listing pages by their newest article", () => {
      expect(sitemap).toContain(
        `<loc>${BASE_URL}</loc>\n    <lastmod>2025-05-05</lastmod>`
      );
      expect(sitemap).toContain(
        `<loc>${BASE_URL}/archive.html</loc>\n    <lastmod>2025-05-05</lastmod>`
      );
    });
  });

  describe("renderRSSFeed", () => {
    it("should include at most 10 escaped items with an author", () => {
      const articles = Array.from({ length: 12 }, (_, i) =>
        makeArticle({ slug: `post-${i}`, title: `Post ${i} & more` })
      );
      const rss = build.renderRSSFeed(articles);

      expect(rss.match(/<item>/g)).toHaveLength(10);
      expect(rss).toContain("<title>Post 0 &amp; more</title>");
      expect(rss).not.toContain("post-10.html");
      expect(rss).toContain(`<dc:creator>${config.site.author}</dc:creator>`);
      expect(rss).toContain("<pubDate>Mon, 15 Jan 2024 00:00:00 GMT</pubDate>");
    });
  });

  describe("generateNotFoundHtml", () => {
    it("should be noindex and use absolute asset URLs", () => {
      const html = build.generateNotFoundHtml();

      expect(html).toContain('<meta name="robots" content="noindex" />');
      expect(html).toContain(`href="${BASE_URL}/styles.css"`);
      expect(html).toContain(`src="${BASE_URL}/site.js"`);
      expect(html).not.toMatch(/(href|src)="(?!https?:|#)[^"]+"/);
      expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });
  });

  describe("git dates", () => {
    it("should parse git log output into first and last dates per file", () => {
      const log = [
        "\0" + "2026-07-30T10:00:00+02:00",
        "",
        "a.html",
        "b.html",
        "\0" + "2025-01-01T09:00:00+01:00",
        "",
        "a.html",
        "c.html",
        "",
      ].join("\n");

      expect(Object.fromEntries(build.parseGitDates(log))).toEqual({
        "a.html": {
          created: "2025-01-01T09:00:00+01:00",
          modified: "2026-07-30T10:00:00+02:00",
        },
        "b.html": {
          created: "2026-07-30T10:00:00+02:00",
          modified: "2026-07-30T10:00:00+02:00",
        },
        "c.html": {
          created: "2025-01-01T09:00:00+01:00",
          modified: "2025-01-01T09:00:00+01:00",
        },
      });
    });

    it("should never date a modification before publication", () => {
      const article = makeArticle({ date: "2025-06-01" });
      const dates = (modified) =>
        new Map([[article.filename, { created: modified, modified }]]);

      expect(build.getModifiedDate(article, dates("2026-01-02T00:00:00Z"))).toBe(
        "2026-01-02T00:00:00.000Z"
      );
      expect(build.getModifiedDate(article, dates("2025-01-01T00:00:00Z"))).toBe(
        "2025-06-01T00:00:00.000Z"
      );
      expect(build.getModifiedDate(article, new Map())).toBe(
        "2025-06-01T00:00:00.000Z"
      );
    });

    it("should return no dates outside a git checkout", () => {
      expect(build.getGitDates(os.tmpdir()).size).toBe(0);
    });

    it("should order same-day articles by when they were first committed", () => {
      const byCreated = (slug, created) =>
        makeArticle({ slug, date: "2026-10-19", created });
      const articles = [
        byCreated("breakup", "2026-10-19T14:32:46+02:00"),
        makeArticle({ slug: "older", date: "2026-10-18" }),
        byCreated("chess", "2026-10-19T14:40:40+02:00"),
        byCreated("chuck", "2026-10-19T14:32:46+02:00"),
        byCreated("uncommitted", undefined),
      ];

      expect(
        articles.sort(build.compareNewestFirst).map((a) => a.slug)
      ).toEqual(["uncommitted", "chess", "breakup", "chuck", "older"]);
    });

    it("should use the same order for previous/next navigation", () => {
      const first = makeArticle({
        slug: "first",
        date: "2026-10-19",
        created: "2026-10-19T10:00:00Z",
      });
      const second = makeArticle({
        slug: "second",
        date: "2026-10-19",
        created: "2026-10-19T11:00:00Z",
      });
      const html = build.renderArticleHtml(first, [first, second]);

      expect(html).toMatch(/post-nav__item--next" href="second\.html"/);
      expect(html).not.toContain("post-nav__item--prev");
    });
  });
});

describe("Template partials", () => {
  it("should expand every partial in every page template", () => {
    for (const name of ["index", "archive", "article", "404"]) {
      const template = build.loadTemplate(name);

      expect(template, name).not.toContain("{{>");
      expect(template, name).toContain('class="site-header"');
      expect(template, name).toContain('class="site-footer"');
      expect(template, name).toContain('rel="stylesheet"');
    }
  });

  it("should mark the current page in the navigation", () => {
    const home = build.generateIndexHtml([makeArticle()]);
    const archive = build.generateArchiveHtml([makeArticle()]);
    const current = (html) =>
      html.match(/<a href="([^"]*)" aria-current="page">/g) || [];

    expect(current(home)).toEqual([`<a href="${BASE_URL}" aria-current="page">`]);
    expect(current(archive)).toEqual([
      '<a href="archive.html" aria-current="page">',
    ]);
    expect(current(build.generateNotFoundHtml())).toEqual([]);
  });

  it("should keep relative asset links outside the 404 page", () => {
    const html = build.generateArchiveHtml([makeArticle()]);

    expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(html).toContain('<script src="site.js" defer></script>');
  });

  // WCAG 2.5.3 (Label in Name): voice control users say the visible text,
  // so the logo link is named by its content rather than an aria-label that
  // could drift from it. The "RL" mark is hidden from the accessible name.
  it("should name the logo link by its visible site name", () => {
    const html = build.generateArchiveHtml([makeArticle()]);
    const [link, content] = html.match(/<a class="wordmark"[^>]*>([\s\S]*?)<\/a>/);

    expect(link.slice(0, link.indexOf(">"))).not.toContain("aria-label");
    expect(content).toContain('aria-hidden="true">RL</span>');
    expect(content).toContain('class="wordmark__text">RobLib&rsquo;s Blog</span>');
  });
});
