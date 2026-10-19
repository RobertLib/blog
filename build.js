const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { decodeEntities } = require("./html-entities");
const { validateSEO } = require("./seo-validate");

function getNestedValue(obj, path) {
  return path.split(".").reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

function validateConfig(config) {
  const required = [
    { path: "site.title", type: "string" },
    { path: "site.baseUrl", type: "string" },
    { path: "build.articlesDir", type: "string" },
    { path: "build.outputDir", type: "string" },
    { path: "build.templatesDir", type: "string" },
    { path: "build.staticDir", type: "string" },
    { path: "build.recentArticlesCount", type: "number" },
  ];

  const errors = [];

  for (const { path, type } of required) {
    const value = getNestedValue(config, path);
    if (!value) {
      errors.push(`Missing required config: ${path}`);
    } else if (typeof value !== type) {
      errors.push(
        `Config ${path} must be of type ${type}, got ${typeof value}`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }

  console.log("✅ Configuration validated successfully");
}

const BASE_URL = config.site.baseUrl;
const ARTICLES_DIR = config.build.articlesDir;
const OUTPUT_DIR = config.build.outputDir;
const TEMPLATES_DIR = config.build.templatesDir;
const STATIC_DIR = config.build.staticDir;
const RECENT_ARTICLES_COUNT = config.build.recentArticlesCount;

const templateCache = new Map();

function clearTemplateCache() {
  templateCache.clear();
}

function loadTemplate(templateName) {
  if (templateCache.has(templateName)) {
    return templateCache.get(templateName);
  }

  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  if (!fs.existsSync(templatePath)) {
    const availableTemplates = fs.existsSync(TEMPLATES_DIR)
      ? fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".html"))
      : [];
    throw new Error(
      `Template ${templateName}.html not found. Available: ${availableTemplates.join(
        ", "
      )}`
    );
  }

  try {
    const content = expandPartials(fs.readFileSync(templatePath, "utf8"));
    templateCache.set(templateName, content);
    return content;
  } catch (error) {
    throw new Error(`Error reading template ${templateName}: ${error.message}`);
  }
}

// Replaces each line holding only "{{> name}}" with templates/partials/
// name.html, which carries its own indentation. Partials are shared markup
// (head assets, header, footer); their placeholders are filled like the
// page's own.
function expandPartials(template) {
  return template.replace(
    /^[ \t]*\{\{>\s*([\w-]+)\s*\}\}[ \t]*$/gm,
    (_, name) => {
      const partialPath = path.join(TEMPLATES_DIR, "partials", `${name}.html`);
      if (!fs.existsSync(partialPath)) {
        throw new Error(`Partial ${name}.html not found`);
      }
      return fs.readFileSync(partialPath, "utf8").replace(/\n$/, "");
    }
  );
}

function extractMetadata(content) {
  const metadata = {};
  const metaRegex = /<!--\s*(\w+):\s*(.+?)\s*-->/g;
  let match;

  while ((match = metaRegex.exec(content)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    metadata[key] = value;
  }

  const cleanContent = content.replace(/<!--\s*\w+:\s*.+?\s*-->/g, "").trim();
  return { metadata, content: cleanContent };
}

// Article dates are calendar days, so date-only strings are pinned to UTC
// midnight whatever their format: JS parses "2024-01-01" as UTC but
// "2024/01/01" and "01/01/2024" as local midnight. Strings with a time keep
// their instant. Impossible days ("2024-02-30") give an invalid date.
function parseDate(dateString) {
  const value = String(dateString).trim();
  const utcDay = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date
      : new Date(NaN);
  };

  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return utcDay(+match[1], +match[2], +match[3]);

  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return utcDay(+match[3], +match[1], +match[2]);

  return new Date(value);
}

// Formatted in UTC to match parseDate; the machine's local time zone would
// otherwise shift the day.
function formatDate(dateString) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}`);
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Compact form for the date column in list views ("Jan 31, 2026")
function formatDateShort(dateString) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}`);
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateISO(dateString) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  return date.toISOString();
}

function validateArticle(article) {
  const errors = [];
  const warnings = [];

  if (!article.title || article.title.trim().length === 0) {
    errors.push("Missing or empty title");
  }

  if (!article.date) {
    errors.push("Missing date");
  } else {
    const date = parseDate(article.date);
    if (isNaN(date.getTime())) {
      errors.push("Invalid date format");
    } else if (date > new Date()) {
      warnings.push("Future date detected");
    }
  }

  if (!article.slug || article.slug.trim().length === 0) {
    errors.push("Missing or invalid slug");
  }

  if (!article.content || article.content.trim().length === 0) {
    errors.push("Article content is empty");
  }

  if (!article.description || article.description.trim().length === 0) {
    errors.push("Missing description");
  }

  if (article.content.length < 100) {
    warnings.push("Content is very short");
  }

  if (errors.length > 0) {
    throw new Error(`Article validation failed: ${errors.join(", ")}`);
  }

  return { errors, warnings };
}

function getArticleData(articleFile, articlesDir = ARTICLES_DIR) {
  try {
    const articlePath = path.join(articlesDir, articleFile);
    const rawContent = fs.readFileSync(articlePath, "utf8");
    const { metadata, content } = extractMetadata(rawContent);

    const article = {
      ...metadata,
      content,
      filename: articleFile,
      slug: path.basename(articleFile, ".html"),
    };

    const { errors, warnings } = validateArticle(article);
    if (warnings.length > 0) {
      console.warn(
        `Article ${articleFile} has warnings: ${warnings.join(", ")}`
      );
    }

    return article;
  } catch (error) {
    console.error(`Error processing article ${articleFile}:`, error.message);
    throw error;
  }
}

// Throws if any article is invalid, so a broken article fails the build
// instead of silently disappearing from the site.
function getAllArticles(articlesDir = ARTICLES_DIR) {
  if (!fs.existsSync(articlesDir)) {
    return [];
  }

  const articles = [];
  const failures = [];
  const files = fs
    .readdirSync(articlesDir)
    .filter((file) => file.endsWith(".html"));

  for (const file of files) {
    try {
      articles.push(getArticleData(file, articlesDir));
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Invalid articles:\n${failures.join("\n")}`);
  }

  return articles.sort(compareNewestFirst);
}

// Dates only have day precision, so articles published on the same day are
// ordered by when they were first committed. Uncommitted (new) articles
// count as the newest; the filename keeps the order deterministic.
function compareNewestFirst(a, b) {
  const createdTime = (article) =>
    article.created ? Date.parse(article.created) : Infinity;
  return (
    parseDate(b.date) - parseDate(a.date) ||
    createdTime(b) - createdTime(a) ||
    a.filename.localeCompare(b.filename)
  );
}

// Parses `git log --format=%x00%aI --name-only` output (newest first) into a
// map of file -> { created, modified }: its first and last commit dates.
function parseGitDates(log) {
  const dates = new Map();
  for (const block of log.split("\0")) {
    const [date, ...files] = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!date) continue;
    for (const file of files) {
      if (dates.has(file)) dates.get(file).created = date;
      else dates.set(file, { created: date, modified: date });
    }
  }
  return dates;
}

// First and last commit dates of every article, from a single `git log`
// call. Author dates are used, so rebasing doesn't make articles look edited.
// Empty outside a git checkout or in a shallow clone (where history is cut
// off), so callers fall back to the publication date.
function getGitDates(articlesDir = ARTICLES_DIR) {
  const git = (args) =>
    execFileSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd: articlesDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      console.warn(
        "Shallow git clone: using publication dates as modification dates"
      );
      return new Map();
    }
    return parseGitDates(
      git(["log", "--format=%x00%aI", "--name-only", "--relative", "--", "."])
    );
  } catch (error) {
    return new Map();
  }
}

// Never earlier than the publication date, e.g. for an article committed
// ahead of the date it is published under.
function getModifiedDate(article, gitDates) {
  const published = parseDate(article.date);
  const committed = gitDates.has(article.filename)
    ? new Date(gitDates.get(article.filename).modified)
    : null;
  return (committed > published ? committed : published).toISOString();
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Escapes a string for a JSON string literal inside an inline <script>,
// where HTML entities are not decoded.
function escapeJsonString(text) {
  return JSON.stringify(String(text)).slice(1, -1).replace(/</g, "\\u003c");
}

// Plain text of an HTML fragment, for word counts and keyword extraction.
function stripHtml(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ");
  // Unknown named entities would otherwise surface as words ("&frac12;")
  return decodeEntities(
    text.replace(/&[a-z]+;/gi, (entity) =>
      decodeEntities(entity) === entity ? " " : entity
    )
  );
}

function countWords(html) {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

function estimateReadingTime(content) {
  const wordsPerMinute = 200;
  return Math.max(1, Math.ceil(countWords(content) / wordsPerMinute));
}

// Single pass over the template only: placeholder-like text and "$&"-style
// patterns inside substituted values (e.g. code samples) are left untouched.
function replaceTemplate(template, replacements) {
  const unresolved = new Set();

  const result = template.replace(/\{\{([^{}]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) {
      unresolved.add(match);
      return match;
    }
    const value = replacements[key];
    return value === undefined || value === null ? "" : String(value);
  });

  if (unresolved.size > 0) {
    console.warn(`Unresolved placeholders: ${[...unresolved].join(", ")}`);
  }

  return result;
}

// Attribute rules only match inside tags, so prose and code samples that
// merely mention "onload=" or "javascript:" stay intact.
function sanitizeHtml(html) {
  let result = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gis, "");

  // One attribute per tag per pass, so repeat until nothing changes
  let previous;
  do {
    previous = result;
    result = result
      .replace(
        /(<[a-z][^>]*?\s)on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        "$1"
      )
      .replace(/(<[a-z][^>]*?)(?:javascript|vbscript)\s*:/gi, "$1");
  } while (result !== previous);

  return result;
}

// Placeholders shared by every page template
function commonReplacements() {
  return {
    "base-url": BASE_URL,
    // Prefix for asset and page links in the partials; relative by default
    root: "",
    author: escapeHtml(config.site.author),
    "json-author": escapeJsonString(config.site.author),
    year: new Date().getFullYear(),
    // Marks the current page in the header navigation
    "nav-home-current": "",
    "nav-archive-current": "",
  };
}

const CURRENT_PAGE = ' aria-current="page"';

function generateIndexHtml(articles = null) {
  const allArticles = articles || getAllArticles();
  const template = loadTemplate("index");

  const recentArticles = allArticles.slice(0, RECENT_ARTICLES_COUNT);

  const articlesList = recentArticles
    .map((article) => {
      const readingTime = estimateReadingTime(article.content);
      return `
        <article class="post-card">
          <p class="eyebrow post-card__meta">
            <time datetime="${escapeHtml(article.date)}">${formatDate(
        article.date
      )}</time>
            <span class="dot" aria-hidden="true"></span>
            <span>${readingTime} min read</span>
          </p>
          <h2 class="post-card__title">
            <a href="${escapeHtml(article.filename)}">${escapeHtml(
        article.title
      )}</a>
          </h2>
          ${
            article.description
              ? `<p class="post-card__excerpt">${escapeHtml(
                  article.description
                )}</p>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  let archiveLink = "";
  if (allArticles.length > RECENT_ARTICLES_COUNT) {
    archiveLink =
      '<p class="list-footer"><a href="archive.html" class="button">View archive</a></p>';
  }

  return replaceTemplate(template, {
    ...commonReplacements(),
    "nav-home-current": CURRENT_PAGE,
    articles: articlesList,
    archive: archiveLink,
    "canonical-url": BASE_URL,
    title: config.site.title,
    description: config.site.description,
  });
}

function generateArchiveHtml(articles = null) {
  const allArticles = articles || getAllArticles();
  const template = loadTemplate("archive");

  const articlesByYear = {};
  allArticles.forEach((article) => {
    if (article.date) {
      const year = parseDate(article.date).getUTCFullYear();
      if (!articlesByYear[year]) {
        articlesByYear[year] = [];
      }
      articlesByYear[year].push(article);
    }
  });

  const sortedYears = Object.keys(articlesByYear).sort((a, b) => b - a);

  const archiveContent = sortedYears
    .map((year) => {
      const yearArticles = articlesByYear[year]
        .map(
          (article) => `
            <li class="archive-item">
              <a href="${escapeHtml(article.filename)}">${escapeHtml(
            article.title
          )}</a>
              <time datetime="${escapeHtml(
                article.date
              )}">${formatDateShort(article.date)}</time>
            </li>
          `
        )
        .join("");

      return `
        <section class="archive-year">
          <h2 class="section-label archive-year__label">${year}</h2>
          <ul class="archive-list">
            ${yearArticles}
          </ul>
        </section>
      `;
    })
    .join("");

  return replaceTemplate(template, {
    ...commonReplacements(),
    "nav-archive-current": CURRENT_PAGE,
    archive: archiveContent,
    "canonical-url": `${BASE_URL}/archive.html`,
    title: config.site.title,
    description: config.site.description,
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirectory(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src);
  entries.forEach((entry) => {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    } else if (stat.isDirectory()) {
      copyDirectory(srcPath, destPath);
    }
  });
}

function copyStatic() {
  if (!fs.existsSync(STATIC_DIR)) {
    console.warn(`Static directory ${STATIC_DIR} not found, skipping...`);
    return;
  }

  try {
    const files = fs.readdirSync(STATIC_DIR);
    files.forEach((file) => {
      const srcPath = path.join(STATIC_DIR, file);
      const destPath = path.join(OUTPUT_DIR, file);

      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${file}`);
      } else if (stat.isDirectory()) {
        copyDirectory(srcPath, destPath);
      }
    });
  } catch (error) {
    console.error(`Error copying static files:`, error.message);
    throw error;
  }
}

function getRelatedArticles(currentArticle, allArticles, maxCount = 3) {
  if (!currentArticle || !allArticles) return [];

  const currentKeywords = extractKeywords(
    currentArticle.content,
    currentArticle.title
  )
    .toLowerCase()
    .split(", ");

  // Filter out current article and calculate similarity scores
  const otherArticles = allArticles
    .filter((article) => article.filename !== currentArticle.filename)
    .map((article) => {
      const articleKeywords = extractKeywords(article.content, article.title)
        .toLowerCase()
        .split(", ");

      // Calculate keyword overlap
      const commonKeywords = currentKeywords.filter((keyword) =>
        articleKeywords.some(
          (ak) => ak.includes(keyword) || keyword.includes(ak)
        )
      );

      const score = commonKeywords.length;
      return { ...article, score };
    })
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount);

  // If no keyword matches, return most recent articles
  if (otherArticles.length === 0) {
    return allArticles
      .filter((article) => article.filename !== currentArticle.filename)
      .sort(compareNewestFirst)
      .slice(0, maxCount);
  }

  return otherArticles;
}

function generateRelatedArticlesHTML(relatedArticles) {
  if (!relatedArticles || relatedArticles.length === 0) {
    return "";
  }

  const articlesList = relatedArticles
    .map(
      (article) => `
      <li>
        <a href="${escapeHtml(article.filename)}">${escapeHtml(
        article.title
      )}</a>
        <time datetime="${escapeHtml(article.date)}">${formatDateShort(
        article.date
      )}</time>
      </li>
    `
    )
    .join("");

  return `
    <section class="related">
      <h2 class="section-label">Related reading</h2>
      <ul class="related__list">
        ${articlesList}
      </ul>
    </section>
  `;
}

function generateArticleNavigation(currentArticle, allArticles) {
  const sortedArticles = allArticles
    .filter((article) => article.date)
    .sort((a, b) => compareNewestFirst(b, a));

  const currentIndex = sortedArticles.findIndex(
    (article) => article.filename === currentArticle.filename
  );

  if (currentIndex === -1) return "";

  const prevArticle =
    currentIndex > 0 ? sortedArticles[currentIndex - 1] : null;
  const nextArticle =
    currentIndex < sortedArticles.length - 1
      ? sortedArticles[currentIndex + 1]
      : null;

  if (!prevArticle && !nextArticle) return "";

  const item = (article, direction, label) => `
        <a class="post-nav__item post-nav__item--${direction}" href="${escapeHtml(
    article.filename
  )}">
          <span class="eyebrow">${label}</span>
          <span class="post-nav__title">${escapeHtml(article.title)}</span>
        </a>
  `;

  return `
      <nav class="post-nav" aria-label="More articles">
        ${prevArticle ? item(prevArticle, "prev", "Previous") : ""}
        ${nextArticle ? item(nextArticle, "next", "Next") : ""}
      </nav>
  `;
}

function renderArticleHtml(article, articles) {
  const template = loadTemplate("article");
  const readingTime = estimateReadingTime(article.content);
  const keywords = extractKeywords(article.content, article.title);
  const wordCount = countWords(article.content);
  const canonicalUrl = `${BASE_URL}/${article.filename}`;

  // Generate related articles and navigation
  const relatedArticles = getRelatedArticles(article, articles);
  const relatedArticlesHTML = generateRelatedArticlesHTML(relatedArticles);
  const navigationHTML = generateArticleNavigation(article, articles);

  return replaceTemplate(template, {
    ...commonReplacements(),
    title: escapeHtml(article.title || "Untitled"),
    date: formatDateISO(article.date),
    "modified-date": article.modified || formatDateISO(article.date),
    "formatted-date": formatDate(article.date),
    description: escapeHtml(article.description || ""),
    content: sanitizeHtml(article.content),
    "reading-time": `${readingTime} min read`,
    "reading-time-minutes": readingTime,
    "canonical-url": canonicalUrl,
    keywords: keywords,
    "word-count": wordCount,
    // JSON-LD lives in a <script>, which needs JSON escaping, not HTML
    "json-title": escapeJsonString(article.title || "Untitled"),
    "json-description": escapeJsonString(article.description || ""),
    "json-keywords": escapeJsonString(keywords),
    // Query-string values for the share links
    "share-url": encodeURIComponent(canonicalUrl),
    "share-title": encodeURIComponent(article.title || ""),
    lede: article.description
      ? `<p class="post__lede">${escapeHtml(article.description)}</p>`
      : "",
    "related-articles": relatedArticlesHTML,
    navigation: navigationHTML,
  });
}

function buildArticle(articleFile, articleData = null, allArticles = null) {
  try {
    const article = articleData || getArticleData(articleFile);
    const articles = allArticles || getAllArticles();
    const html = renderArticleHtml(article, articles);

    const outputPath = path.join(OUTPUT_DIR, articleFile);
    fs.writeFileSync(outputPath, html);
    return article;
  } catch (error) {
    console.error(`Error building ${articleFile}:`, error.message);
    throw error;
  }
}

function buildIndex(articles) {
  const html = generateIndexHtml(articles);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html);
}

function buildArchive(articles) {
  const html = generateArchiveHtml(articles);
  fs.writeFileSync(path.join(OUTPUT_DIR, "archive.html"), html);
}

// GitHub Pages serves 404.html for any missing path, including nested ones,
// so the template references assets through absolute URLs.
function generateNotFoundHtml() {
  const template = loadTemplate("404");
  return replaceTemplate(template, {
    ...commonReplacements(),
    root: `${BASE_URL}/`,
  });
}

function buildNotFound() {
  const html = generateNotFoundHtml();
  fs.writeFileSync(path.join(OUTPUT_DIR, "404.html"), html);
}

function renderSitemap(articles) {
  const sitemapItems = [];
  const day = (iso) => iso.split("T")[0];
  const articleLastmods = articles.map((article) =>
    day(article.modified || formatDateISO(article.date))
  );
  // Listing pages change exactly when some article does
  const listingLastmod =
    articleLastmods.length > 0
      ? articleLastmods.reduce((a, b) => (a > b ? a : b))
      : day(new Date().toISOString());

  // Add homepage
  sitemapItems.push({
    url: BASE_URL,
    lastmod: listingLastmod,
    changefreq: "daily",
    priority: 1.0,
  });

  // Add archive page
  sitemapItems.push({
    url: `${BASE_URL}/archive.html`,
    lastmod: listingLastmod,
    changefreq: "weekly",
    priority: 0.8,
  });

  // Add articles
  articles.forEach((article, index) => {
    sitemapItems.push({
      url: `${BASE_URL}/${article.filename}`,
      lastmod: articleLastmods[index],
      changefreq: "monthly",
      priority: 0.9,
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapItems
  .map(
    (item) => `  <url>
    <loc>${item.url}</loc>
    <lastmod>${item.lastmod}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;
}

function generateSitemap(articles) {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "sitemap.xml"),
    renderSitemap(articles)
  );
  console.log("✅ Sitemap generated");
}

function renderRSSFeed(articles) {
  const recentArticles = articles.slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(config.site.title)}</title>
    <link>${BASE_URL}</link>
    <description>${escapeXml(config.site.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    ${recentArticles
      .map(
        (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${BASE_URL}/${article.filename}</link>
      <description>${escapeXml(article.description || "")}</description>
      <dc:creator>${escapeXml(config.site.author)}</dc:creator>
      <pubDate>${parseDate(article.date).toUTCString()}</pubDate>
      <guid>${BASE_URL}/${article.filename}</guid>
    </item>`
      )
      .join("")}
  </channel>
</rss>`;
}

function generateRSSFeed(articles) {
  fs.writeFileSync(path.join(OUTPUT_DIR, "feed.xml"), renderRSSFeed(articles));
  console.log("✅ RSS feed generated");
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INDEXNOW_TIMEOUT_MS = 15000;

// Resolves to false only when a submission was attempted and every endpoint
// failed, so callers can report it (the deploy workflow then retries these
// pages on its next run).
async function submitToIndexNow(urls) {
  if (!config.indexNow.enabled) {
    console.log("IndexNow is disabled (not in production mode)");
    return true;
  }

  if (!urls || urls.length === 0) {
    console.log("No URLs to submit to IndexNow");
    return true;
  }

  const payload = {
    host: new URL(BASE_URL).hostname,
    key: config.indexNow.apiKey,
    keyLocation: `${BASE_URL}/${config.indexNow.apiKey}.txt`,
    urlList: urls,
  };

  console.log(`\n🔗 Submitting ${urls.length} URLs to IndexNow...`);

  for (const endpoint of config.indexNow.endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
      });

      if (response.ok) {
        const status = response.status;
        if (status === 200) {
          console.log(`✅ IndexNow: Successfully submitted to ${endpoint}`);
        } else if (status === 202) {
          console.log(
            `✅ IndexNow: URLs accepted for processing by ${endpoint}`
          );
        } else {
          console.log(
            `✅ IndexNow: Submitted to ${endpoint} (status: ${status})`
          );
        }
        return true; // Success with first endpoint, no need to try others
      } else {
        console.warn(
          `⚠️ IndexNow: Failed to submit to ${endpoint} (status: ${response.status})`
        );
      }
    } catch (error) {
      console.warn(
        `⚠️ IndexNow: Error submitting to ${endpoint}:`,
        error.message
      );
    }
  }

  console.log("❌ IndexNow: Failed to submit to any endpoint");
  return false;
}

function extractKeywords(content, title) {
  const commonWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "up",
    "about",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "among",
    "under",
    "over",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "might",
    "must",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "their",
    "what",
    "when",
    "where",
    "why",
    "how",
    "all",
    "any",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "can",
    "will",
    "just",
    "now",
    "also",
    "as",
    "back",
    "get",
    "go",
    "make",
    "see",
    "know",
    "take",
    "think",
    "come",
    "give",
    "look",
    "use",
    "find",
    "tell",
    "ask",
    "work",
    "seem",
    "feel",
    "try",
    "leave",
    "call",
    // Generic filler that otherwise links unrelated articles
    "one",
    "two",
    "three",
    "every",
    "there",
    "here",
    "who",
    "which",
    "while",
    "without",
    "within",
    "need",
    "never",
    "always",
    "way",
    "often",
    "something",
    "someone",
    "everything",
    "instead",
    "comes",
    "become",
    "becomes",
    "new",
    "good",
    "even",
    "still",
    "much",
    "many",
    "really",
    "then",
    "because",
    "like",
    // Contraction stems left behind by the 3+ letter word match
    "don",
    "doesn",
    "didn",
    "isn",
    "aren",
    "wasn",
    "won",
  ]);

  const text = (title + " " + stripHtml(content)).toLowerCase();
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  const wordCount = {};

  words.forEach((word) => {
    if (!commonWords.has(word)) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  });

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)
    .join(", ");
}

async function build() {
  try {
    console.log("🚀 Starting blog build...");

    clearTemplateCache();
    console.log("🧹 Template cache cleared");

    validateConfig(config);

    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
      console.log("🧹 Cleaned output directory");
    }
    ensureDir(OUTPUT_DIR);

    console.log("📁 Copying static files...");
    copyStatic();

    console.log("📝 Processing articles...");
    const articles = getAllArticles();

    if (articles.length === 0) {
      console.log("No articles found in articles directory");
      return;
    }

    // "created" orders same-day articles; "modified" feeds sitemap <lastmod>
    // and JSON-LD dateModified
    const gitDates = getGitDates();
    articles.forEach((article) => {
      article.created = gitDates.get(article.filename)?.created;
      article.modified = getModifiedDate(article, gitDates);
    });
    articles.sort(compareNewestFirst);

    // Build every article first so all failures are reported at once
    const failures = [];

    articles.forEach((article) => {
      try {
        buildArticle(article.filename, article, articles);
        console.log(`Generated: ${article.filename}`);
      } catch (error) {
        failures.push(`${article.filename}: ${error.message}`);
      }
    });

    if (failures.length > 0) {
      throw new Error(`Failed to generate articles:\n${failures.join("\n")}`);
    }

    buildIndex(articles);
    console.log("Generated index.html");

    buildArchive(articles);
    console.log("Generated archive.html");

    buildNotFound();
    console.log("Generated 404.html");

    generateSitemap(articles);
    console.log("Generated sitemap.xml");

    generateRSSFeed(articles);
    console.log("Generated feed.xml");

    console.log(`\nBuild complete: ${articles.length} articles generated`);

    // IndexNow is submitted by the deploy workflow once the site is live
    // (see index-now.js), never from the build itself.

    // Run SEO validation
    console.log("\n🔍 Running SEO validation...");
    const seoSuccess = validateSEO(OUTPUT_DIR);

    if (!seoSuccess) {
      console.log("\n❌ Build completed but SEO validation failed");
      process.exit(1);
    }

    console.log(
      "\n✅ Build completed successfully with all SEO checks passed!"
    );
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    loadTemplate,
    extractMetadata,
    parseDate,
    formatDate,
    formatDateShort,
    formatDateISO,
    validateArticle,
    getArticleData,
    getAllArticles,
    escapeHtml,
    escapeJsonString,
    stripHtml,
    countWords,
    estimateReadingTime,
    extractKeywords,
    replaceTemplate,
    sanitizeHtml,
    compareNewestFirst,
    parseGitDates,
    getGitDates,
    getModifiedDate,
    generateIndexHtml,
    generateNotFoundHtml,
    generateArchiveHtml,
    renderArticleHtml,
    buildArticle,
    renderSitemap,
    generateSitemap,
    renderRSSFeed,
    generateRSSFeed,
    submitToIndexNow,
    build,
    ensureDir,
    copyDirectory,
    copyStatic,
    buildIndex,
    buildArchive,
    buildNotFound,
    clearTemplateCache,
    validateSEO,
  };
}

if (require.main === module) {
  build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}
