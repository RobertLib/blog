const fs = require("fs");
const path = require("path");
const config = require("./config");
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
    const content = fs.readFileSync(templatePath, "utf8");
    templateCache.set(templateName, content);
    return content;
  } catch (error) {
    throw new Error(`Error reading template ${templateName}: ${error.message}`);
  }
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

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}`);
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateISO(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
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
    const date = new Date(article.date);
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

  if (!article.description) {
    warnings.push("Missing description - recommended for SEO");
  }

  if (article.content.length < 100) {
    warnings.push("Content is very short");
  }

  if (errors.length > 0) {
    throw new Error(`Article validation failed: ${errors.join(", ")}`);
  }

  return { errors, warnings };
}

function getArticleData(articleFile) {
  try {
    const articlePath = path.join(ARTICLES_DIR, articleFile);
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

function getAllArticles() {
  if (!fs.existsSync(ARTICLES_DIR)) {
    return [];
  }

  const articles = [];
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((file) => file.endsWith(".html"));

  for (const file of files) {
    try {
      articles.push(getArticleData(file));
    } catch (error) {
      console.warn(`Skipping article ${file}: ${error.message}`);
    }
  }

  return articles.sort((a, b) => new Date(b.date) - new Date(a.date));
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

function estimateReadingTime(content) {
  const wordsPerMinute = 200;
  const text = content.replace(/<[^>]*>/g, "");
  const wordCount = text.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / wordsPerMinute);
  return readingTime;
}

function replaceTemplate(template, replacements) {
  let result = template;
  const usedPlaceholders = new Set();

  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    if (regex.test(result)) {
      usedPlaceholders.add(key);
      result = result.replace(regex, value || "");
    }
  }

  const remainingPlaceholders = result.match(/\{\{[^}]+\}\}/g);
  if (remainingPlaceholders) {
    console.warn(
      `Unresolved placeholders: ${remainingPlaceholders.join(", ")}`
    );
  }

  return result;
}

function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gis, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/vbscript:/gi, "");
}

function generateIndexHtml(articles = null) {
  const allArticles = articles || getAllArticles();
  const template = loadTemplate("index");

  const recentArticles = allArticles.slice(0, RECENT_ARTICLES_COUNT);

  const articlesList = recentArticles
    .map((article) => {
      const readingTime = estimateReadingTime(article.content);
      return `
        <article>
          <h2>
            <a href="${escapeHtml(article.filename)}">
              ${escapeHtml(article.title)}
            </a>
          </h2>
          <div class="article-meta">
            <time datetime="${escapeHtml(article.date)}">
              ${formatDate(article.date)}
            </time>
            <span class="reading-time">${readingTime} min read</span>
          </div>
          ${
            article.description
              ? `<p>${escapeHtml(article.description)}</p>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  let archiveLink = "";
  if (allArticles.length > RECENT_ARTICLES_COUNT) {
    archiveLink =
      '<p style="text-align: center; margin-top: 2rem;"><a href="archive.html" class="button">View Archive</a></p>';
  }

  return replaceTemplate(template, {
    articles: articlesList,
    archive: archiveLink,
    "canonical-url": BASE_URL,
    "base-url": BASE_URL,
    title: config.site.title,
    description: config.site.description,
  });
}

function generateArchiveHtml() {
  const articles = getAllArticles();
  const template = loadTemplate("archive");

  const articlesByYear = {};
  articles.forEach((article) => {
    if (article.date) {
      const year = new Date(article.date).getFullYear();
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
            <li>
              <a href="${article.filename}">${article.title}</a>
              <time datetime="${article.date}">
                ${formatDate(article.date)}
              </time>
            </li>
          `
        )
        .join("");

      return `
        <section class="archive-section">
          <h2>${year}</h2>
          <ul>
            ${yearArticles}
          </ul>
        </section>
      `;
    })
    .join("");

  return replaceTemplate(template, {
    archive: archiveContent,
    "canonical-url": `${BASE_URL}/archive.html`,
    "base-url": BASE_URL,
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
      .sort((a, b) => new Date(b.date) - new Date(a.date))
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
        <a href="${escapeHtml(article.filename)}">
          ${escapeHtml(article.title)}
        </a>
        <time datetime="${escapeHtml(article.date)}">
          ${formatDate(article.date)}
        </time>
      </li>
    `
    )
    .join("");

  return `
    <section class="related-articles">
      <h2>Related Articles</h2>
      <ul>
        ${articlesList}
      </ul>
    </section>
  `;
}

function generateArticleNavigation(currentArticle, allArticles) {
  const sortedArticles = allArticles
    .filter((article) => article.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

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

  let navigation = "";

  if (prevArticle || nextArticle) {
    navigation = '<div class="article-nav">';

    if (prevArticle) {
      navigation += `
        <div class="article-nav-prev">
          <span class="nav-label">&lt; Previous Article</span>
          <a href="${escapeHtml(prevArticle.filename)}">
            ${escapeHtml(prevArticle.title)}
          </a>
        </div>
      `;
    }

    if (nextArticle) {
      navigation += `
        <div class="article-nav-next">
          <span class="nav-label">Next Article &gt;</span>
          <a href="${escapeHtml(nextArticle.filename)}">
            ${escapeHtml(nextArticle.title)}
          </a>
        </div>
      `;
    }

    navigation += "</div>";
  }

  return navigation;
}

function buildArticle(articleFile, articleData = null, allArticles = null) {
  try {
    const article = articleData || getArticleData(articleFile);
    const articles = allArticles || getAllArticles();
    const template = loadTemplate("article");
    const readingTime = estimateReadingTime(article.content);
    const keywords = extractKeywords(article.content, article.title);
    const wordCount = article.content.split(/\s+/).length;

    // Generate related articles and navigation
    const relatedArticles = getRelatedArticles(article, articles);
    const relatedArticlesHTML = generateRelatedArticlesHTML(relatedArticles);
    const navigationHTML = generateArticleNavigation(article, articles);

    const html = replaceTemplate(template, {
      title: escapeHtml(article.title || "Untitled"),
      date: formatDateISO(article.date),
      "formatted-date": formatDate(article.date),
      description: escapeHtml(article.description || ""),
      content: sanitizeHtml(article.content),
      "reading-time": `${readingTime} min read`,
      "reading-time-minutes": readingTime,
      "canonical-url": `${BASE_URL}/${article.filename}`,
      "base-url": BASE_URL,
      keywords: keywords,
      "word-count": wordCount,
      "related-articles": relatedArticlesHTML,
      navigation: navigationHTML,
    });

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

function buildArchive() {
  const html = generateArchiveHtml();
  fs.writeFileSync(path.join(OUTPUT_DIR, "archive.html"), html);
}

function generateSitemap(articles) {
  const sitemapItems = [];

  // Add homepage
  sitemapItems.push({
    url: BASE_URL,
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: 1.0,
  });

  // Add archive page
  sitemapItems.push({
    url: `${BASE_URL}/archive.html`,
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "weekly",
    priority: 0.8,
  });

  // Add articles
  articles.forEach((article) => {
    sitemapItems.push({
      url: `${BASE_URL}/${article.filename}`,
      lastmod: new Date(article.date).toISOString().split("T")[0],
      changefreq: "monthly",
      priority: 0.9,
    });
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
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

  fs.writeFileSync(path.join(OUTPUT_DIR, "sitemap.xml"), sitemap);
  console.log("✅ Sitemap generated");
}

function generateRSSFeed(articles) {
  const recentArticles = articles.slice(0, 10);

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${config.site.title}</title>
    <link>${BASE_URL}</link>
    <description>${config.site.description}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <managingEditor>${config.site.author}</managingEditor>
    <webMaster>${config.site.author}</webMaster>
    ${recentArticles
      .map(
        (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${BASE_URL}/${article.filename}</link>
      <description>${escapeXml(article.description)}</description>
      <pubDate>${new Date(article.date).toUTCString()}</pubDate>
      <guid>${BASE_URL}/${article.filename}</guid>
    </item>`
      )
      .join("")}
  </channel>
</rss>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, "feed.xml"), rss);
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

async function submitToIndexNow(urls) {
  if (!config.indexNow.enabled) {
    console.log("IndexNow is disabled (not in production mode)");
    return;
  }

  if (!urls || urls.length === 0) {
    console.log("No URLs to submit to IndexNow");
    return;
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
        return; // Success with first endpoint, no need to try others
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
  ]);

  const text = (title + " " + content).toLowerCase();
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

    const successfulArticles = [];

    articles.forEach((article) => {
      try {
        const builtArticle = buildArticle(article.filename, article, articles);
        successfulArticles.push(builtArticle);
        console.log(`Generated: ${article.filename}`);
      } catch (error) {
        console.error(`Error generating ${article.filename}:`, error.message);
      }
    });

    buildIndex(successfulArticles);
    console.log("Generated index.html");

    buildArchive();
    console.log("Generated archive.html");

    generateSitemap(successfulArticles);
    console.log("Generated sitemap.xml");

    generateRSSFeed(successfulArticles);
    console.log("Generated feed.xml");

    console.log(
      `\nBuild complete: ${successfulArticles.length} articles generated`
    );

    // Submit to IndexNow
    if (config.indexNow.enabled) {
      const urlsToSubmit = [
        BASE_URL, // Homepage
        `${BASE_URL}/archive.html`, // Archive page
        ...successfulArticles.map(
          (article) => `${BASE_URL}/${article.filename}`
        ), // All articles
      ];
      await submitToIndexNow(urlsToSubmit);
    }

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
    formatDate,
    formatDateISO,
    validateArticle,
    getArticleData,
    getAllArticles,
    escapeHtml,
    estimateReadingTime,
    replaceTemplate,
    sanitizeHtml,
    generateIndexHtml,
    generateArchiveHtml,
    buildArticle,
    generateSitemap,
    generateRSSFeed,
    submitToIndexNow,
    build,
    ensureDir,
    copyDirectory,
    copyStatic,
    buildIndex,
    buildArchive,
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
