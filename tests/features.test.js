import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as build from "../build.js";
import config from "../config.js";
import { imageSize, imageSizeFromBuffer } from "../image-size.js";

const BASE_URL = config.site.baseUrl;

const tempDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-features-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const jsonLd = (html) =>
  JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
  );

function makeArticle(overrides = {}) {
  const slug = overrides.slug || "test-article";
  return {
    title: "Test Article",
    date: "2024-01-15",
    description: "A test description",
    content: "<p>Rust compilers are fast. Rust compilers matter.</p>",
    slug,
    filename: `${slug}.html`,
    type: "article",
    tags: [],
    discuss: [],
    ...overrides,
  };
}

const tags = (value) => build.parseTags(value);

describe("Tags", () => {
  it("should slugify labels for URLs", () => {
    expect(build.slugify("Next.js")).toBe("nextjs");
    expect(build.slugify("Web Development")).toBe("web-development");
    expect(build.slugify("  C++ / Žluťoučký  ")).toBe("cpp-zlutoucky");
  });

  it("should keep C, C++ and C# apart", () => {
    expect(["C", "C++", "C#", "F#", "Google+"].map(build.slugify)).toEqual([
      "c",
      "cpp",
      "csharp",
      "fsharp",
      "google-plus",
    ]);
    expect(build.parseTags("C, C++, C#").map((tag) => tag.slug)).toEqual([
      "c",
      "cpp",
      "csharp",
    ]);
  });

  it("should parse a comma-separated list, dropping duplicates", () => {
    expect(build.parseTags("Games, C,  WebAssembly, games")).toEqual([
      { label: "Games", slug: "games" },
      { label: "C", slug: "c" },
      { label: "WebAssembly", slug: "webassembly" },
    ]);
    expect(build.parseTags("")).toEqual([]);
    expect(build.parseTags(undefined)).toEqual([]);
  });

  it("should collect tags with their articles, most used first", () => {
    const a = makeArticle({ slug: "a", date: "2024-01-01", tags: tags("AI, Games") });
    const b = makeArticle({ slug: "b", date: "2024-02-01", tags: tags("Games") });
    const collected = build.collectTags([a, b]);

    expect(collected.map((tag) => tag.slug)).toEqual(["games", "ai"]);
    expect(collected[0].articles.map((article) => article.slug)).toEqual([
      "b",
      "a",
    ]);
  });

  it("should render tag pages one directory down", () => {
    const [games] = build.collectTags([
      makeArticle({ slug: "a", tags: tags("Games") }),
    ]);
    const html = build.generateTagHtml(games);

    expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/tags/games.html" />`);
    expect(html).toContain('href="../a.html"');
    expect(html).toContain('href="../styles.css"');
    expect(html).toContain("<h1>Games</h1>");
    expect(html).toContain(
      "<title>Articles about Games - RobLib&#039;s Blog</title>"
    );
    expect(html).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("should fill out a one-post topic's description with the post's own", () => {
    const [single] = build.collectTags([
      makeArticle({
        slug: "a",
        title: "One Post",
        description: "What the one post is about, in a sentence.",
        tags: tags("Society"),
      }),
    ]);
    const description = build
      .generateTagHtml(single)
      .match(/<meta name="description" content="([^"]*)"/)[1];

    expect(description).toContain("1 post about Society");
    expect(description).toContain(
      "One Post. What the one post is about, in a sentence."
    );
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("should give topic links a readable name, count included", () => {
    const html = build.generateArchiveHtml([
      makeArticle({ slug: "a", filename: "a.html", tags: tags("Games") }),
      makeArticle({ slug: "b", filename: "b.html", tags: tags("Games") }),
    ]);
    const link = html.match(/<a class="tag" href="tags\/games\.html">.*?<\/a>/)[0];
    // What a screen reader announces: the visible label and the hidden count
    const name = link
      .replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, "")
      .replace(/<[^>]+>/g, "");

    expect(name).toBe("Games (2 posts)");
  });

  it("should prefer articles sharing tags as related reading", () => {
    const current = makeArticle({ slug: "current", tags: tags("Games") });
    const sameTag = makeArticle({
      slug: "same-tag",
      date: "2020-01-01",
      content: "<p>Nothing in common.</p>",
      tags: tags("Games"),
    });
    const sameWords = makeArticle({
      slug: "same-words",
      date: "2025-01-01",
      tags: tags("AI"),
    });

    const related = build.getRelatedArticles(current, [current, sameWords, sameTag]);

    expect(related[0].slug).toBe("same-tag");
    expect(related.map((article) => article.slug)).not.toContain("current");
  });
});

describe("Article metadata", () => {
  function writeArticle(dir, name, text) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }

  it("should read tags, discussion links and a cover image", () => {
    const dir = tempDir();
    const staticDir = path.join(dir, "static");
    fs.mkdirSync(path.join(staticDir, "images"), { recursive: true });
    fs.copyFileSync(
      "static/images/chuck/sector-02.png",
      path.join(staticDir, "images", "cover.png")
    );
    writeArticle(
      path.join(dir, "articles"),
      "post.html",
      [
        "<!-- title: Post -->",
        "<!-- date: 2024-01-01 -->",
        "<!-- description: A description of the post. -->",
        "<!-- tags: Games, C -->",
        "<!-- image: /images/cover.png -->",
        "<!-- discuss: https://news.ycombinator.com/item?id=1, https://lobste.rs/s/abc -->",
        "<p>Body text that is long enough to not trigger the short content warning, really.</p>",
      ].join("\n")
    );

    const article = build.getArticleData(
      "post.html",
      path.join(dir, "articles"),
      staticDir
    );

    expect(article.type).toBe("article");
    expect(article.tags.map((tag) => tag.slug)).toEqual(["games", "c"]);
    expect(article.image).toBe("images/cover.png");
    expect(article.discuss).toEqual([
      "https://news.ycombinator.com/item?id=1",
      "https://lobste.rs/s/abc",
    ]);
    expect(article.content).not.toContain("<!--");
  });

  it("should fail when the cover image does not exist", () => {
    const dir = tempDir();
    writeArticle(
      path.join(dir, "articles"),
      "post.html",
      "<!-- title: Post -->\n<!-- date: 2024-01-01 -->\n<!-- description: D -->\n<!-- image: images/missing.png -->\n<p>Body</p>"
    );

    expect(() =>
      build.getArticleData("post.html", path.join(dir, "articles"), dir)
    ).toThrow("Image not found");
  });

  it("should let notes go without a description", () => {
    const dir = tempDir();
    writeArticle(
      path.join(dir, "articles"),
      "note.html",
      `<!-- title: A note -->\n<!-- date: 2024-01-01 -->\n<!-- type: note -->\n<!-- link: https://example.org/post -->\n<p>${"Interesting point here. ".repeat(12)}</p>`
    );

    const note = build.getArticleData("note.html", path.join(dir, "articles"));

    expect(note.type).toBe("note");
    expect(note.link).toBe("https://example.org/post");
    expect(note.description.length).toBeLessThanOrEqual(160);
    expect(note.description.endsWith("…")).toBe(true);
    expect(note.description.startsWith("Interesting point here.")).toBe(true);
  });

  it("should reject unknown types and invalid URLs", () => {
    const base = makeArticle();

    expect(() => build.validateArticle({ ...base, type: "essay" })).toThrow(
      'Unknown type "essay"'
    );
    expect(() => build.validateArticle({ ...base, link: "notaurl" })).toThrow(
      "Invalid link URL"
    );
    expect(() =>
      build.validateArticle({ ...base, discuss: "ftp://x" })
    ).toThrow("Invalid discuss URL");
    expect(() =>
      build.validateArticle({ ...base, image: "https://cdn.example/a.png" })
    ).toThrow("Image must be a path");
    expect(() =>
      build.validateArticle({ ...base, type: "note", description: "" })
    ).not.toThrow();
  });
});

describe("Embeds and images", () => {
  it("should keep iframes only from allowed hosts, loading lazily", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const allowed =
      '<iframe src="https://itch.io/embed-upload/1"></iframe>';
    const blocked = '<iframe src="https://evil.example/x"></iframe>';

    expect(build.sanitizeHtml(allowed)).toBe(
      '<iframe src="https://itch.io/embed-upload/1" loading="lazy"></iframe>'
    );
    expect(build.sanitizeHtml(blocked)).toBe("");
    // Look-alike hosts and plain http don't pass
    expect(build.isAllowedEmbedUrl("https://itch.io.evil.example/")).toBe(false);
    expect(build.isAllowedEmbedUrl("http://itch.io/embed-upload/1")).toBe(false);
    warn.mockRestore();
  });

  it("should strip click-to-play URLs from hosts that are not allowed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = '<figure class="embed" data-embed="https://itch.io/embed-upload/1">';
    const bad = '<figure class="embed" data-embed="https://evil.example/">';

    expect(build.sanitizeHtml(ok)).toBe(ok);
    expect(build.sanitizeHtml(bad)).toBe('<figure class="embed">');
    warn.mockRestore();
  });

  it("should give click-to-play blocks their frame's shape at build time", () => {
    const tag = (ratio) =>
      `<figure class="embed" data-embed="https://itch.io/embed-upload/1"${
        ratio === undefined ? "" : ` data-embed-ratio="${ratio}"`
      }>`;

    expect(build.enhanceEmbeds(tag("800 / 582"))).toContain(
      'style="--embed-ratio: 800 / 582"'
    );
    expect(build.enhanceEmbeds(tag("1.5"))).toContain(
      'style="--embed-ratio: 1.5"'
    );
    expect(() => build.enhanceEmbeds(tag("800 / 582; color: red"))).toThrow(
      /Invalid data-embed-ratio/
    );

    // Without a ratio the stylesheet's 16:9 applies
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(build.enhanceEmbeds(tag())).toBe(tag());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("should keep unstyled lists lists and let wide tables scroll", () => {
    const html = build.enhanceContent(
      '<ul class="profile-links"><li>a</li></ul><table><tr><td>1</td></tr></table>'
    );

    expect(html).toContain('<ul class="profile-links" role="list">');
    expect(html).toContain(
      '<div class="table-scroll" tabindex="0"><table><tr><td>1</td></tr></table></div>'
    );
  });

  it("should load the whole first row of the project grids eagerly", () => {
    const projects = build.loadProjects();
    const loading = (html) =>
      html.match(/<img[^>]*>/g).map((tag) => /loading="lazy"/.test(tag));

    expect(loading(build.generateIndexHtml([], projects)).slice(0, 3)).toEqual([
      false,
      false,
      true,
    ]);
    expect(loading(build.generateProjectsHtml(projects)).slice(0, 3)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("should size local images and lazy-load all but the first", () => {
    const html = build.enhanceImages(
      '<img src="images/chuck/sector-02.png" alt="a" /><img src="images/chuck/facade.png" alt="b" width="10" height="5" /><img src="https://cdn.example/x.png" alt="c">'
    );
    const tags = html.match(/<img[^>]*>/g);

    expect(tags[0]).toContain('width="1600" height="1104"');
    expect(tags[0]).not.toContain("loading=");
    expect(tags[1]).toContain('width="10" height="5"');
    expect(tags[1]).toContain('loading="lazy"');
    expect(tags[2]).toContain('loading="lazy"');
    expect(tags[2]).not.toContain("width=");
  });

  it("should load the first image eagerly only near the top", () => {
    const img = '<img src="images/chuck/sector-02.png" alt="a" />';
    const words = (n) => `<p>${"word ".repeat(n)}</p>`;

    expect(build.enhanceImages(words(40) + img)).not.toContain("loading=");
    expect(build.enhanceImages(words(300) + img)).toContain('loading="lazy"');
  });

  it("should make code blocks keyboard-focusable", () => {
    expect(build.enhanceCodeBlocks('<pre><code>x</code></pre>')).toBe(
      '<pre tabindex="0"><code>x</code></pre>'
    );
    expect(build.enhanceContent('<pre class="a">x</pre>')).toBe(
      '<pre class="a" tabindex="0">x</pre>'
    );
  });

  it("should fail on a local image that does not exist", () => {
    expect(() =>
      build.enhanceImages('<img src="images/nope.png" alt="" />')
    ).toThrow("Image not found");
  });

  it("should read image sizes from file headers", () => {
    expect(imageSize("static/images/chuck/sector-02.png")).toEqual({
      width: 1600,
      height: 1104,
    });
    expect(imageSize("static/images/robert-libsansky.jpg")).toEqual({
      width: 240,
      height: 240,
    });
    expect(imageSize("static/images/breakup/perks.webp")).toEqual({
      width: 1200,
      height: 900,
    });
    const gif = Buffer.from("GIF89a\x20\x03\x28\x02", "latin1");
    expect(imageSizeFromBuffer(gif)).toEqual({ width: 800, height: 552 });
    expect(imageSizeFromBuffer(Buffer.from("not an image"))).toBeNull();
  });

  it("should resolve relative URLs for feed readers", () => {
    expect(
      build.absolutizeUrls(
        '<a href="a.html">a</a><a href="#x">x</a><a href="https://o.example/">o</a><img src="images/i.png">',
        "https://example.com/post.html"
      )
    ).toBe(
      '<a href="https://example.com/a.html">a</a><a href="https://example.com/post.html#x">x</a><a href="https://o.example/">o</a><img src="https://example.com/images/i.png">'
    );
  });

  it("should leave markup shown in code samples as written", () => {
    const sample = '<pre><code>&lt;a href="docs.html"&gt;Docs&lt;/a&gt;</code></pre>';
    expect(
      build.absolutizeUrls(sample, "https://example.com/post.html")
    ).toBe(sample);
  });
});

describe("Article page", () => {
  it("should render tags, a cover image and discussion links", () => {
    const article = makeArticle({
      tags: tags("Games, C"),
      image: "images/chuck/sector-02.png",
      discuss: [
        "https://news.ycombinator.com/item?id=1",
        "https://www.reddit.com/r/gamedev/comments/abc/",
      ],
    });
    const html = build.renderArticleHtml(article, [article]);
    const data = jsonLd(html);

    expect(html).toContain('<a class="tag" href="tags/games.html">Games</a>');
    expect(html).toContain('<meta property="article:tag" content="C" />');
    expect(html).toContain('<meta property="article:section" content="Games" />');
    expect(html).toContain(">Hacker News</a>");
    expect(html).toContain(">r/gamedev</a>");
    expect(data.keywords).toBe("Games, C");
    expect(data.image).toContain(`${BASE_URL}/images/chuck/sector-02.png`);
    expect(html).toContain('<meta name="twitter:creator" content="@RobertLibsansky" />');
  });

  it("should leave out article:section for an untagged article", () => {
    const article = makeArticle({ tags: [] });
    const html = build.renderArticleHtml(article, [article]);

    expect(html).not.toContain('property="article:section"');
    expect(jsonLd(html).articleSection).toBeUndefined();
  });

  it("should render notes without a lede or reading time", () => {
    const note = makeArticle({
      type: "note",
      link: "https://example.org/post",
      description: "Derived from the text",
    });
    const html = build.renderArticleHtml(note, [note]);

    expect(html).toContain('<span class="badge">Note</span>');
    expect(html).not.toContain("min read");
    expect(html).not.toContain('class="post__lede"');
    expect(html).toContain('href="https://example.org/post"');
  });

  it("should use the article's own social card when it exists", () => {
    const article = makeArticle({
      slug: "chuck-stealth-platformer-600-kilobytes",
    });
    const html = build.renderArticleHtml(article, [article]);

    expect(html).toContain(
      `<meta property="og:image" content="${BASE_URL}/og/chuck-stealth-platformer-600-kilobytes.png" />`
    );
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
  });

  it("should drop the site name from titles that would be cut off", () => {
    expect(build.pageTitle("Short")).toBe(`Short - ${config.site.title}`);
    const long = "A title that is already long enough on its own here";
    expect(build.pageTitle(long)).toBe(long);
  });

  it("should label discussion sites", () => {
    expect(build.discussionLabel("https://news.ycombinator.com/item?id=1")).toBe(
      "Hacker News"
    );
    expect(build.discussionLabel("https://lobste.rs/s/x")).toBe("Lobsters");
    expect(build.discussionLabel("https://old.reddit.com/r/C_Programming/x")).toBe(
      "r/C_Programming"
    );
    expect(build.discussionLabel("https://forum.example/t/1")).toBe(
      "forum.example"
    );
  });
});

describe("Analytics and subscriptions", () => {
  it("should add GoatCounter only to configured production builds", () => {
    expect(build.analyticsHtml({ goatcounter: "" }, true)).toBe("");
    expect(build.analyticsHtml({ goatcounter: "roblib" }, false)).toBe("");
    expect(build.analyticsHtml({ goatcounter: "roblib" }, true)).toContain(
      'data-goatcounter="https://roblib.goatcounter.com/count"'
    );
    expect(() =>
      build.analyticsHtml({ goatcounter: 'x" onload="' }, true)
    ).toThrow("Invalid GoatCounter code");
  });

  it("should offer RSS until a newsletter is configured", () => {
    const rss = build.subscribeHtml("", { buttondown: "" });
    expect(rss).toContain('href="feed.xml"');
    expect(rss).not.toContain("<form");

    const form = build.subscribeHtml("../", { buttondown: "roblib" });
    expect(form).toContain(
      'action="https://buttondown.com/api/emails/embed-subscribe/roblib"'
    );
    expect(form).toContain('href="../feed.xml"');
    expect(() => build.subscribeHtml("", { buttondown: "a b" })).toThrow();
  });
});

describe("Projects and pages", () => {
  it("should load the real projects file", () => {
    const projects = build.loadProjects();

    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((project) => project.featured)).toBe(true);
  });

  it("should reject invalid projects", () => {
    const dir = tempDir();
    const file = path.join(dir, "projects.json");

    fs.writeFileSync(
      file,
      JSON.stringify([{ name: "X", summary: "S", url: "https://x.example", category: "toys" }])
    );
    expect(() => build.loadProjects(file)).toThrow("category must be one of");

    fs.writeFileSync(
      file,
      JSON.stringify([
        { name: "X", summary: "S", url: "https://x.example", category: "web", article: "missing.html" },
      ])
    );
    expect(() => build.loadProjects(file)).toThrow("article missing.html not found");

    expect(build.loadProjects(path.join(dir, "none.json"))).toEqual([]);
  });

  it("should report a project that is not an object instead of crashing", () => {
    const dir = tempDir();
    const file = path.join(dir, "projects.json");
    fs.writeFileSync(file, JSON.stringify([null]));

    expect(() => build.loadProjects(file)).toThrow("Project #1 is not an object");
  });

  it("should accept project images with a leading slash", () => {
    const dir = tempDir();
    const file = path.join(dir, "projects.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          name: "Chuck",
          summary: "S",
          url: "https://g.example",
          category: "games",
          image: "/images/chuck/sector-09.png",
        },
      ])
    );

    const projects = build.loadProjects(file);
    const page = build.generateProjectsHtml(projects);

    expect(projects[0].image).toBe("images/chuck/sector-09.png");
    expect(page).toContain('src="images/chuck/sector-09.png"');
  });

  it("should group projects by category and feature some on the home page", () => {
    const projects = [
      { name: "Game", category: "games", summary: "S", url: "https://g.example", featured: true },
      { name: "Site", category: "web", summary: "S", url: "https://w.example" },
    ];
    const page = build.generateProjectsHtml(projects);
    const home = build.generateIndexHtml([makeArticle()], projects);

    expect(page.indexOf('id="projects-games"')).toBeLessThan(
      page.indexOf('id="projects-web"')
    );
    expect(page).not.toContain('id="projects-apps"');
    expect(home).toContain("Game");
    expect(home).not.toContain("Site");
  });

  it("should render the About page as a profile", () => {
    const [about] = build.getAllPages().filter((page) => page.slug === "about");
    const html = build.generatePageHtml(about);
    const data = jsonLd(html);

    expect(data["@type"]).toBe("ProfilePage");
    expect(data.mainEntity.sameAs).toContain("https://github.com/RobertLib");
    expect(html).toContain('<meta property="og:type" content="profile" />');
  });

  it("should list every kind of page for the sitemap", () => {
    const article = makeArticle({ tags: tags("Games") });
    const urls = build
      .sitePages([article], {
        pages: [{ filename: "about.html" }],
        projects: [{}],
      })
      .map((entry) => entry.url);

    expect(urls).toEqual([
      BASE_URL,
      `${BASE_URL}/archive.html`,
      `${BASE_URL}/projects.html`,
      `${BASE_URL}/about.html`,
      `${BASE_URL}/tags/games.html`,
      `${BASE_URL}/test-article.html`,
    ]);
  });
});

describe("Social cards", () => {
  it("should describe one card per page with its own", () => {
    const article = makeArticle({ tags: tags("Games, C") });
    const specs = build.socialCardSpecs(
      [article],
      [{ slug: "about", title: "About" }],
      [{ featured: true, image: "images/x.png" }]
    );
    const files = specs.map((spec) => spec.file);

    expect(files).toEqual([
      "og-image.png",
      "og/test-article.png",
      "og/about.png",
      // Equally used tags are ordered by name
      "og/tag-c.png",
      "og/tag-games.png",
      "og/projects.png",
    ]);
    expect(specs[1].eyebrow).toBe("Games · C");
  });

  it("should report missing and outdated cards", () => {
    const dir = tempDir();
    const spec = { file: "og/a.png", title: "A", eyebrow: "", image: null };
    fs.mkdirSync(path.join(dir, "og"));

    expect(build.staleSocialCards([spec], dir, {})).toEqual([spec]);

    fs.writeFileSync(path.join(dir, "og", "a.png"), "");
    const manifest = { "og/a.png": build.socialCardHash(spec, dir) };
    expect(build.staleSocialCards([spec], dir, manifest)).toEqual([]);

    const renamed = { ...spec, title: "B" };
    expect(build.staleSocialCards([renamed], dir, manifest)).toEqual([renamed]);
  });
});

describe("IndexNow URLs for new page types", () => {
  const { urlsForChangedFiles, allSiteUrls } = require("../index-now.js");
  const site = {
    baseUrl: "https://example.com",
    articleFiles: ["a.html", "b.html"],
    pageFiles: ["about.html"],
    hasProjects: true,
    tagsByArticle: { "a.html": ["games"], "b.html": ["ai", "games"] },
  };

  it("should list every page", () => {
    expect(allSiteUrls(site)).toEqual([
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/projects.html",
      "https://example.com/about.html",
      "https://example.com/tags/ai.html",
      "https://example.com/tags/games.html",
      "https://example.com/a.html",
      "https://example.com/b.html",
    ]);
  });

  it("should submit the tag pages of a changed article", () => {
    expect(urlsForChangedFiles(["articles/a.html"], site)).toEqual([
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/a.html",
      "https://example.com/tags/games.html",
    ]);
  });

  it("should submit pages and the projects page when they change", () => {
    expect(urlsForChangedFiles(["pages/about.html"], site)).toEqual([
      "https://example.com/about.html",
    ]);
    expect(urlsForChangedFiles(["projects.json"], site)).toEqual([
      "https://example.com",
      "https://example.com/projects.html",
    ]);
  });

  it("should submit the tag pages a deleted or retagged article left", () => {
    const before = { ...site, previousTagsByArticle: { "gone.html": ["c"], "a.html": ["ios"] } };
    expect(urlsForChangedFiles(["articles/gone.html"], before)).toContain(
      "https://example.com/tags/c.html"
    );
    expect(urlsForChangedFiles(["articles/a.html"], before)).toEqual([
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/a.html",
      "https://example.com/tags/games.html",
      "https://example.com/tags/ios.html",
    ]);
    // Also when a site-wide change submits every current page
    expect(
      urlsForChangedFiles(["build.js", "articles/gone.html"], before)
    ).toContain("https://example.com/tags/c.html");
  });

  it("should read the tags an article had at an earlier commit", () => {
    const { tagsAtCommit } = require("../index-now.js");
    const { execFileSync } = require("child_process");
    const os = require("os");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "indexnow-tags-"));
    const git = (...args) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repo,
        stdio: "ignore",
      });
    try {
      git("init", "-q");
      fs.mkdirSync(path.join(repo, "articles"));
      fs.writeFileSync(
        path.join(repo, "articles", "a.html"),
        "<!-- title: A -->\n<!-- tags: Games, Next.js -->\n<p>Text</p>\n"
      );
      git("add", ".");
      git("commit", "-q", "-m", "a");
      fs.rmSync(path.join(repo, "articles", "a.html"));

      expect(
        tagsAtCommit("HEAD", ["articles/a.html", "articles/new.html"], repo)
      ).toEqual({ "a.html": ["games", "nextjs"] });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("Languages", () => {
  const cs = (overrides = {}) => makeArticle({ lang: "cs", ...overrides });
  const translations = (entries) => new Map(Object.entries(entries));

  it("should put other languages in their directory, the default at the root", () => {
    expect(build.langPath("archive.html", "en")).toBe("archive.html");
    expect(build.langPath("archive.html", "cs")).toBe("cs/archive.html");
    expect(build.pageUrl("", "en")).toBe(BASE_URL);
    expect(build.pageUrl("", "cs")).toBe(`${BASE_URL}/cs/`);
    expect(build.pageUrl("tags/ai.html", "cs")).toBe(`${BASE_URL}/cs/tags/ai.html`);
    expect(build.contentDir("articles", "cs")).toBe(path.join("articles", "cs"));
  });

  it("should translate tag labels and keep their slugs", () => {
    const tags = build.parseTags("Games, Hry, AI, Web Development");
    expect(build.localizeTags(tags, "cs")).toEqual([
      { label: "Hry", slug: "games" },
      { label: "AI", slug: "ai" },
      { label: "Vývoj webu", slug: "web-development" },
    ]);
    expect(build.localizeTags(tags.slice(0, 1), "en")).toEqual([
      { label: "Games", slug: "games" },
    ]);
  });

  it("should load translations from the language's directory", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "cs"));
    fs.writeFileSync(
      path.join(dir, "cs", "game.html"),
      "<!-- title: Moje hra -->\n<!-- date: 2024-01-01 -->\n<!-- description: Popis hry -->\n<!-- tags: Games -->\n<p>Text</p>"
    );
    const [article] = build.getAllArticles(path.join(dir, "cs"), "cs");
    expect(article.lang).toBe("cs");
    expect(article.tags).toEqual([{ label: "Hry", slug: "games" }]);
    // The language directory is not an article of the default language
    expect(build.getAllArticles(dir)).toEqual([]);
  });

  it("should typeset Czech text without touching markup or code", () => {
    expect(
      build.typeset('<p>Hra v C a <a href="a b">odkaz</a> s 10 000 hráči – 40 %</p>', "cs")
    ).toBe('<p>Hra v&nbsp;C a&nbsp;<a href="a b">odkaz</a> s&nbsp;10&nbsp;000 hráči&nbsp;– 40&nbsp;%</p>');
    expect(build.typeset("<pre>a b\nv c</pre><code>k x</code>", "cs")).toBe(
      "<pre>a b\nv c</pre><code>k x</code>"
    );
    // A word ending in an inline element is not a one-letter word
    expect(build.typeset("<em>dom</em>a pak", "cs")).toBe("<em>dom</em>a pak");
    expect(build.typeset("<p>a v k</p>", "en")).toBe("<p>a v k</p>");
  });

  it("should count posts with Czech plurals", () => {
    const tag = (count) => ({
      label: "Hry",
      slug: "games",
      articles: Array.from({ length: count }, (_, i) =>
        cs({ slug: `a${i}`, title: `Článek ${i}` })
      ),
    });
    expect(build.generateTagHtml(tag(1))).toContain("1 příspěvek, od nejnovějších.");
    expect(build.generateTagHtml(tag(3))).toContain("3 příspěvky, od nejnovějších.");
    expect(build.generateTagHtml(tag(5))).toContain("5 příspěvků, od nejnovějších.");
  });

  it("should render a translation in its language with hreflang links", () => {
    const article = cs({
      title: "Testovací článek",
      content: '<p>Obrázek <img src="images/chuck/facade.png" alt="Fasáda" /> a <a href="other.html">jiný</a> a <a href="test-article.html#x">tento</a>.</p>',
    });
    const html = build.renderArticleHtml(article, [article], {
      translations: translations({
        "": ["en", "cs"],
        "test-article.html": ["en", "cs"],
        "other.html": ["en"],
      }),
    });

    expect(html).toContain('<html lang="cs">');
    expect(html).toContain('<meta property="og:locale" content="cs_CZ" />');
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US" />');
    expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/cs/test-article.html" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="${BASE_URL}/test-article.html" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="cs" href="${BASE_URL}/cs/test-article.html" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${BASE_URL}/test-article.html" />`);
    expect(html).toContain(`<a class="lang-switch" href="${BASE_URL}/test-article.html" hreflang="en" lang="en" title="English">EN</a>`);
    expect(html).toContain("15. ledna 2024");
    expect(html).toContain("min čtení");
    expect(jsonLd(html).inLanguage).toBe("cs-CZ");
    // Static files live at the site root, untranslated pages in English,
    // translated ones next to it
    expect(html).toContain('src="../images/chuck/facade.png"');
    expect(html).toContain('href="../other.html"');
    expect(html).toContain('href="test-article.html#x"');
    expect(html).toContain('href="../styles.css"');
    expect(html).toContain('<link rel="preload" href="../fonts/inter-latin-ext.woff2"');
  });

  it("should link the language switch to the other home page when a page is not translated", () => {
    const article = makeArticle({ lang: "en" });
    const html = build.renderArticleHtml(article, [article], {
      translations: translations({ "": ["en", "cs"], "test-article.html": ["en"] }),
    });
    expect(html).toContain(`<a class="lang-switch" href="${BASE_URL}/cs/" hreflang="cs" lang="cs" title="Česky">CS</a>`);
    expect(html).not.toContain('hreflang="x-default"');
    // Without translations (a site in one language) there is no switch
    expect(build.renderArticleHtml(article, [article])).not.toContain("lang-switch");
  });

  it("should mirror the original's related reading in a translation", () => {
    const originals = [
      makeArticle({ slug: "a", tags: [{ label: "Games", slug: "games" }] }),
      makeArticle({ slug: "b", date: "2024-01-10", tags: [{ label: "Games", slug: "games" }] }),
      makeArticle({ slug: "c", date: "2024-01-05", tags: [{ label: "AI", slug: "ai" }] }),
    ];
    const translated = originals.map((article) =>
      cs({ ...article, title: `CZ ${article.slug}`, tags: build.localizeTags(article.tags, "cs") })
    );
    const html = build.renderArticleHtml(translated[0], translated, {
      originals,
    });
    const related = html.slice(html.indexOf('class="related"'));
    expect(related).toContain("Související články");
    expect(related.indexOf("CZ b")).toBeLessThan(related.indexOf("CZ c"));
  });

  it("should give each language its own feed and social cards", () => {
    const article = cs({ title: "Testovací článek", tags: [{ label: "Hry", slug: "games" }] });
    const feed = build.renderRSSFeed([article]);
    expect(feed).toContain("<language>cs</language>");
    expect(feed).toContain(`<atom:link href="${BASE_URL}/cs/feed.xml"`);
    expect(feed).toContain(`<link>${BASE_URL}/cs/test-article.html</link>`);

    const files = build.socialCardSpecs([article], [], [{ name: "X", featured: true }], "cs").map(
      (spec) => spec.file
    );
    expect(files).toEqual([
      "og-image-cs.png",
      "og/cs/test-article.png",
      "og/cs/tag-games.png",
      "og/cs/projects.png",
    ]);
  });

  it("should translate projects and validate their translations", () => {
    expect(
      build.localizeProject(
        { name: "A", summary: "Game", translations: { cs: { summary: "Hra" } } },
        "cs"
      )
    ).toEqual({ name: "A", summary: "Hra" });

    const dir = tempDir();
    const file = path.join(dir, "projects.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          name: "A",
          summary: "Game",
          url: "https://example.com",
          category: "games",
          translations: { xx: {}, cs: { url: "https://evil.example" } },
        },
      ])
    );
    expect(() => build.loadProjects(file)).toThrow(/unknown language "xx"/);
    expect(() => build.loadProjects(file)).toThrow(/translations\.cs\.url/);
  });

  it("should index every page of the site by the languages it exists in", () => {
    const site = [
      { lang: "en", articles: [makeArticle({ slug: "a", tags: [{ label: "AI", slug: "ai" }] })], pages: [{ filename: "about.html" }], projects: [{}] },
      { lang: "cs", articles: [cs({ slug: "a", tags: [{ label: "AI", slug: "ai" }] })], pages: [], projects: [{}] },
    ];
    const index = build.translationIndex(site);
    expect(index.get("")).toEqual(["en", "cs"]);
    expect(index.get("a.html")).toEqual(["en", "cs"]);
    expect(index.get("tags/ai.html")).toEqual(["en", "cs"]);
    expect(index.get("about.html")).toEqual(["en"]);
  });

  it("should submit translated pages to IndexNow in their language", () => {
    const { urlsForChangedFiles, allSiteUrls } = require("../index-now.js");
    const site = {
      baseUrl: "https://example.com",
      articleFiles: ["a.html", "cs/a.html"],
      pageFiles: ["about.html", "cs/about.html"],
      hasProjects: true,
      tagsByArticle: { "a.html": ["ai"], "cs/a.html": ["ai"] },
    };
    expect(urlsForChangedFiles(["articles/cs/a.html"], site)).toEqual([
      "https://example.com/cs/",
      "https://example.com/cs/archive.html",
      "https://example.com/cs/a.html",
      "https://example.com/cs/tags/ai.html",
    ]);
    expect(urlsForChangedFiles(["pages/cs/about.html"], site)).toEqual([
      "https://example.com/cs/about.html",
    ]);
    expect(urlsForChangedFiles(["projects.json"], site)).toEqual([
      "https://example.com",
      "https://example.com/projects.html",
      "https://example.com/cs/",
      "https://example.com/cs/projects.html",
    ]);
    expect(allSiteUrls(site)).toEqual([
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/projects.html",
      "https://example.com/about.html",
      "https://example.com/tags/ai.html",
      "https://example.com/a.html",
      "https://example.com/cs/",
      "https://example.com/cs/archive.html",
      "https://example.com/cs/projects.html",
      "https://example.com/cs/about.html",
      "https://example.com/cs/tags/ai.html",
      "https://example.com/cs/a.html",
    ]);
    expect(urlsForChangedFiles(["i18n.js"], site)).toEqual(allSiteUrls(site));
  });
});
