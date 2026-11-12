const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { decodeEntities } = require("./html-entities");
const { imageSize } = require("./image-size");
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
const PAGES_DIR = config.build.pagesDir || "pages";
const PROJECTS_FILE = config.build.projectsFile || "projects.json";
const RECENT_ARTICLES_COUNT = config.build.recentArticlesCount;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Social card used when an article has none of its own
const DEFAULT_SOCIAL_IMAGE = "og-image.png";
// Generated per-article social cards (tools/og-images.js)
const SOCIAL_CARDS_DIR = "og";
// The <title> suffix, dropped when it would push the title past what search
// results display
const TITLE_SUFFIX = ` - ${config.site.title}`;
const MAX_DISPLAYED_TITLE = 60;

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
  const metaRegex = /<!--\s*([\w-]+):\s*(.+?)\s*-->/g;
  let match;

  while ((match = metaRegex.exec(content)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    metadata[key] = value;
  }

  const cleanContent = content
    .replace(/<!--\s*[\w-]+:\s*.+?\s*-->/g, "")
    .trim();
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

// URL-safe form of a tag label: "Next.js" -> "nextjs", "Web Development" ->
// "web-development"
function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "Games, C, WebAssembly" -> [{ label: "Games", slug: "games" }, ...]
// Duplicates (by slug) are dropped, keeping the first spelling.
function parseTags(value) {
  if (!value) return [];
  const seen = new Set();
  const tags = [];
  for (const raw of String(value).split(",")) {
    const label = raw.trim();
    const slug = slugify(label);
    if (!label || !slug || seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ label, slug });
  }
  return tags;
}

// Comma- or whitespace-separated URLs
function parseUrlList(value) {
  if (!value) return [];
  return String(value)
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
}

// Only https pages on the hosts listed in config.embeds may be embedded
function isAllowedEmbedUrl(value, allowedHosts = config.embeds.allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname);
  } catch (error) {
    return false;
  }
}

// A path inside static/ ("images/chuck/tower.png"), not a URL or data URI
function isLocalPath(value) {
  return (
    Boolean(value) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("//") &&
    !value.startsWith("#")
  );
}

function stripLeadingSlash(value) {
  return String(value).replace(/^\/+/, "");
}

// Meta description for posts that don't set one (notes): the opening text,
// cut at a word boundary
function deriveDescription(html, maxLength = 160) {
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s,;:.\-–—]+$/,
    ""
  )}…`;
}

const ARTICLE_TYPES = ["article", "note"];

function validateArticle(article) {
  const errors = [];
  const warnings = [];
  const type = article.type || "article";

  if (!article.title || article.title.trim().length === 0) {
    errors.push("Missing or empty title");
  }

  if (!ARTICLE_TYPES.includes(type)) {
    errors.push(`Unknown type "${type}" (use ${ARTICLE_TYPES.join(" or ")})`);
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

  // Notes are short enough for their opening text to describe them
  if (
    type !== "note" &&
    (!article.description || article.description.trim().length === 0)
  ) {
    errors.push("Missing description");
  }

  if (article.link && !isHttpUrl(article.link)) {
    errors.push(`Invalid link URL: ${article.link}`);
  }

  for (const url of parseUrlList(article.discuss)) {
    if (!isHttpUrl(url)) errors.push(`Invalid discuss URL: ${url}`);
  }

  if (article.image && !isLocalPath(article.image)) {
    errors.push(
      `Image must be a path inside the static directory: ${article.image}`
    );
  }

  if (article.content && article.content.length < 100 && type !== "note") {
    warnings.push("Content is very short");
  }

  if (errors.length > 0) {
    throw new Error(`Article validation failed: ${errors.join(", ")}`);
  }

  return { errors, warnings };
}

function getArticleData(
  articleFile,
  articlesDir = ARTICLES_DIR,
  staticDir = STATIC_DIR
) {
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

    article.type = article.type || "article";
    article.tags = parseTags(metadata.tags);
    article.discuss = parseUrlList(metadata.discuss);
    if (!article.description) {
      article.description = deriveDescription(content);
    }
    if (article.image) {
      article.image = stripLeadingSlash(article.image);
      if (!fs.existsSync(path.join(staticDir, article.image))) {
        throw new Error(
          `Image not found: ${path.join(staticDir, article.image)}`
        );
      }
    }
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
// Value of an attribute in a single opening tag, entities decoded
function getAttribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3]);
}

function hasAttribute(tag, name) {
  return new RegExp(`\\s${name}(?:\\s*=|[\\s/>])`, "i").test(tag);
}

// Adds an attribute before the end of an opening tag unless it is present
function addAttribute(tag, name, value) {
  if (hasAttribute(tag, name)) return tag;
  return tag.replace(
    /\s*\/?>$/,
    (end) => ` ${name}="${escapeHtml(String(value))}"${end}`
  );
}

function removeAttribute(tag, name) {
  return tag.replace(
    new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi"),
    ""
  );
}

// Iframes survive only when they point at an allowed host; they load lazily.
function sanitizeIframe(iframe) {
  const open = iframe.match(/^<iframe\b[^>]*>/i)[0];
  const src = getAttribute(open, "src");
  if (!src || !isAllowedEmbedUrl(src)) {
    if (src) console.warn(`Removed iframe from a host not allowed: ${src}`);
    return "";
  }
  return addAttribute(open, "loading", "lazy") + iframe.slice(open.length);
}

// Click-to-play blocks ([data-embed]) become iframes in the browser, so
// their URLs go through the same allowlist
function sanitizeEmbedBlocks(html) {
  return html.replace(/<[a-z][^>]*\sdata-embed\s*=[^>]*>/gi, (tag) => {
    const src = getAttribute(tag, "data-embed");
    if (src && isAllowedEmbedUrl(src)) return tag;
    console.warn(`Removed embed from a host not allowed: ${src}`);
    return removeAttribute(tag, "data-embed");
  });
}

function sanitizeHtml(html) {
  let result = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, "")
    .replace(
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gis,
      sanitizeIframe
    );
  result = sanitizeEmbedBlocks(result);

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

// Local images get their pixel size (no layout shift while loading) and,
// except the first one, which is likely in view on load, lazy loading.
// A local image that doesn't exist fails the build.
function enhanceImages(html, staticDir = STATIC_DIR) {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    let result = tag;
    const src = getAttribute(tag, "src");

    if (src && isLocalPath(src)) {
      const file = path.join(
        staticDir,
        stripLeadingSlash(src.split(/[?#]/)[0])
      );
      if (!fs.existsSync(file)) {
        throw new Error(`Image not found: ${file}`);
      }
      if (!hasAttribute(tag, "width") && !hasAttribute(tag, "height")) {
        const size = imageSize(file);
        if (size) {
          result = addAttribute(result, "width", size.width);
          result = addAttribute(result, "height", size.height);
        }
      }
    }

    if (!hasAttribute(tag, "alt")) {
      console.warn(`Image without alt text: ${src}`);
    }

    result = addAttribute(result, "decoding", "async");
    if (index++ > 0) result = addAttribute(result, "loading", "lazy");
    return result;
  });
}

// Relative links and image sources resolved against the page URL, for
// content shown outside the site (RSS readers)
function absolutizeUrls(html, pageUrl) {
  return html.replace(
    /(\s(?:href|src)\s*=\s*)(["'])(.*?)\2/gi,
    (match, prefix, quote, value) => {
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
        return match;
      }
      return `${prefix}${quote}${new URL(value, pageUrl).href}${quote}`;
    }
  );
}

// ------------------------------------------------------------
// Shared page parts
// ------------------------------------------------------------

const DEFAULT_SOCIAL_IMAGE_ALT = `${config.site.title}: small software, games and the web`;

function twitterProfileUrl() {
  const handle = String(config.site.twitter || "").replace(/^@/, "");
  return handle ? `https://x.com/${handle}` : null;
}

// GoatCounter page view counting; production builds only, so local
// previews are never counted
function analyticsHtml(
  analytics = config.analytics,
  production = IS_PRODUCTION
) {
  const code = analytics && analytics.goatcounter;
  if (!code || !production) return "";
  if (!/^[a-z0-9-]+$/i.test(code)) {
    throw new Error(`Invalid GoatCounter code: ${code}`);
  }
  return `<script data-goatcounter="https://${code}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`;
}

// Email sign-up through Buttondown when configured, otherwise an RSS call
// to action
function subscribeHtml(root = "", newsletter = config.newsletter) {
  const user = newsletter && newsletter.buttondown;
  const rss = `<a href="${root}feed.xml">RSS</a>`;
  const xUrl = twitterProfileUrl();
  const xLink = xUrl
    ? ` or follow <a href="${escapeHtml(xUrl)}" target="_blank" rel="noopener">${escapeHtml(config.site.twitter)}</a> on X`
    : "";

  if (user) {
    if (!/^[\w-]+$/.test(user)) {
      throw new Error(`Invalid Buttondown username: ${user}`);
    }
    return `
        <section class="subscribe" aria-labelledby="subscribe-title">
          <h2 class="subscribe__title" id="subscribe-title">Get new posts by email</h2>
          <p class="subscribe__text">
            One short email whenever something new is published. No spam,
            unsubscribe with one click.
          </p>
          <form class="subscribe__form" action="https://buttondown.com/api/emails/embed-subscribe/${user}" method="post" target="_blank">
            <label class="visually-hidden" for="subscribe-email">Email address</label>
            <input class="subscribe__input" type="email" name="email" id="subscribe-email" placeholder="you@example.com" autocomplete="email" required />
            <input type="hidden" name="embed" value="1" />
            <button class="button button--accent" type="submit">Subscribe</button>
          </form>
          <p class="subscribe__alt meta">Prefer a feed reader? Follow via ${rss}${xLink}.</p>
        </section>`;
  }

  return `
        <section class="subscribe" aria-labelledby="subscribe-title">
          <h2 class="subscribe__title" id="subscribe-title">Follow along</h2>
          <p class="subscribe__text">
            New posts about small software, games and the web. Subscribe via
            ${rss}${xLink}.
          </p>
          <p class="subscribe__actions">
            <a class="button button--accent" href="${root}feed.xml">Subscribe via RSS</a>
          </p>
        </section>`;
}

// Placeholders shared by every page template. `root` prefixes asset and page
// links: empty (relative) at the top level, "../" in subdirectories and the
// absolute site URL on the 404 page.
function commonReplacements(root = "") {
  return {
    "base-url": BASE_URL,
    root,
    author: escapeHtml(config.site.author),
    "json-author": escapeJsonString(config.site.author),
    twitter: escapeHtml(config.site.twitter || ""),
    year: new Date().getFullYear(),
    analytics: analyticsHtml(),
    subscribe: subscribeHtml(root),
    // Marks the current page in the header navigation
    "nav-archive-current": "",
    "nav-projects-current": "",
    "nav-about-current": "",
  };
}

const CURRENT_PAGE = ' aria-current="page"';

// The suffix is dropped when the full title would be cut off in search
// results
function pageTitle(title) {
  const full = `${title}${TITLE_SUFFIX}`;
  return full.length <= MAX_DISPLAYED_TITLE ? full : title;
}

const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// The page's own generated card (og/<key>.png) when it exists
function socialImageFile(key, staticDir = STATIC_DIR) {
  if (key) {
    const card = `${SOCIAL_CARDS_DIR}/${key}.png`;
    if (fs.existsSync(path.join(staticDir, card))) return card;
  }
  return DEFAULT_SOCIAL_IMAGE;
}

function socialImageReplacements(file, alt, staticDir = STATIC_DIR) {
  const filePath = path.join(staticDir, file);
  const size = fs.existsSync(filePath) ? imageSize(filePath) : null;
  return {
    "social-image": escapeHtml(`${BASE_URL}/${file}`),
    "social-image-type":
      IMAGE_TYPES[path.extname(file).toLowerCase()] || "image/png",
    "social-image-width": size ? size.width : 1200,
    "social-image-height": size ? size.height : 630,
    "social-image-alt": escapeHtml(alt),
  };
}

function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(
    data,
    null,
    2
  ).replace(/</g, "\\u003c")}</script>`;
}

// Everything the head-meta partial needs
function headReplacements({
  title,
  documentTitle = pageTitle(title),
  socialTitle = title,
  description,
  canonicalUrl,
  ogType = "website",
  socialKey = null,
  socialAlt = null,
  jsonLd = null,
  extraMeta = "",
}) {
  const imageFile = socialImageFile(socialKey);
  const alt =
    imageFile === DEFAULT_SOCIAL_IMAGE
      ? DEFAULT_SOCIAL_IMAGE_ALT
      : socialAlt || socialTitle;
  return {
    "page-title": escapeHtml(documentTitle),
    "social-title": escapeHtml(socialTitle),
    description: escapeHtml(description || ""),
    "canonical-url": escapeHtml(canonicalUrl),
    "og-type": ogType,
    ...socialImageReplacements(imageFile, alt),
    "extra-meta": extraMeta,
    "json-ld": jsonLd ? jsonLdScript(jsonLd) : "",
  };
}

function authorSchema() {
  return {
    "@type": "Person",
    "@id": `${BASE_URL}/about.html#person`,
    name: config.site.author,
    url: `${BASE_URL}/about.html`,
    image: config.site.authorImage
      ? `${BASE_URL}/${config.site.authorImage}`
      : undefined,
    jobTitle: config.site.authorJobTitle,
    sameAs: (config.site.profiles || []).map((profile) => profile.url),
  };
}

function tagUrl(tag, root = "") {
  return `${root}tags/${tag.slug}.html`;
}

function tagLinksHtml(tags, root = "", className = "tag") {
  return (tags || [])
    .map(
      (tag) =>
        `<a class="${className}" href="${tagUrl(tag, root)}">${escapeHtml(
          tag.label
        )}</a>`
    )
    .join("");
}

const isNote = (article) => article.type === "note";

// Eyebrow line of an article in lists and on its page
function postMetaHtml(article, { long = true } = {}) {
  const parts = [];
  if (isNote(article)) parts.push('<span class="badge">Note</span>');
  parts.push(
    `<time datetime="${escapeHtml(article.date)}">${
      long ? formatDate(article.date) : formatDateShort(article.date)
    }</time>`
  );
  if (!isNote(article)) {
    parts.push(`<span>${estimateReadingTime(article.content)} min read</span>`);
  }
  return parts.join('<span class="dot" aria-hidden="true"></span>');
}

function postCardHtml(article, root = "") {
  const tags = article.tags || [];
  return `
        <article class="post-card${isNote(article) ? " post-card--note" : ""}">
          <p class="eyebrow post-card__meta">${postMetaHtml(article)}</p>
          <h2 class="post-card__title">
            <a href="${root}${escapeHtml(article.filename)}">${escapeHtml(
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
          ${
            tags.length > 0
              ? `<p class="post-card__tags">${tagLinksHtml(tags, root)}</p>`
              : ""
          }
        </article>
      `;
}

// ------------------------------------------------------------
// Tags
// ------------------------------------------------------------

// Every tag with its articles (newest first), most used first
function collectTags(articles) {
  const bySlug = new Map();
  for (const article of articles) {
    for (const tag of article.tags || []) {
      if (!bySlug.has(tag.slug)) {
        bySlug.set(tag.slug, { ...tag, articles: [] });
      }
      bySlug.get(tag.slug).articles.push(article);
    }
  }
  return [...bySlug.values()]
    .map((tag) => ({
      ...tag,
      articles: [...tag.articles].sort(compareNewestFirst),
    }))
    .sort(
      (a, b) =>
        b.articles.length - a.articles.length || a.label.localeCompare(b.label)
    );
}

function topicsHtml(tags, root = "") {
  if (tags.length === 0) return "";
  const items = tags
    .map(
      (tag) =>
        `<li><a class="tag" href="${tagUrl(tag, root)}">${escapeHtml(
          tag.label
        )}<span class="tag__count">${tag.articles.length}</span></a></li>`
    )
    .join("");
  return `
        <section class="topics" aria-labelledby="topics-heading">
          <h2 class="section-label" id="topics-heading">Topics</h2>
          <ul class="tag-cloud">${items}</ul>
        </section>`;
}

function truncateText(text, maxLength) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s,;:.\-–—]+$/,
    ""
  )}…`;
}

function tagDescription(tag) {
  const count = tag.articles.length;
  const titles = tag.articles.map((article) => article.title).join("; ");
  return truncateText(
    `${count} ${count === 1 ? "post" : "posts"} about ${tag.label} by ${
      config.site.author
    }: ${titles}`,
    160
  );
}

function generateTagHtml(tag) {
  const template = loadTemplate("tag");
  const root = "../";
  const canonicalUrl = `${BASE_URL}/${tagUrl(tag)}`;
  const count = tag.articles.length;
  const description = tagDescription(tag);

  return replaceTemplate(template, {
    ...commonReplacements(root),
    ...headReplacements({
      title: tag.label,
      socialTitle: `Articles about ${tag.label}`,
      description,
      canonicalUrl,
      socialKey: `tag-${tag.slug}`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${tag.label} - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: "en-US",
        author: authorSchema(),
      },
    }),
    "nav-archive-current": CURRENT_PAGE,
    "tag-label": escapeHtml(tag.label),
    "tag-summary": `${count} ${count === 1 ? "post" : "posts"}, newest first.`,
    articles: tag.articles.map((article) => postCardHtml(article, root)).join(""),
  });
}

// ------------------------------------------------------------
// Projects (projects.json): the Projects page and the home page showcase
// ------------------------------------------------------------

const PROJECT_CATEGORIES = [
  { key: "games", title: "Games" },
  { key: "apps", title: "Apps" },
  { key: "web", title: "Web" },
];

function validateProject(project, index) {
  const errors = [];
  const label = project && project.name ? project.name : `#${index + 1}`;
  if (!project || typeof project !== "object") {
    return [`Project ${label} is not an object`];
  }
  for (const key of ["name", "summary", "url"]) {
    if (!project[key] || typeof project[key] !== "string") {
      errors.push(`Project ${label}: missing ${key}`);
    }
  }
  if (!PROJECT_CATEGORIES.some((c) => c.key === project.category)) {
    errors.push(
      `Project ${label}: category must be one of ${PROJECT_CATEGORIES.map(
        (c) => c.key
      ).join(", ")}`
    );
  }
  for (const key of ["url", "source"]) {
    if (project[key] && !isHttpUrl(project[key])) {
      errors.push(`Project ${label}: invalid ${key} URL`);
    }
  }
  return errors;
}

function loadProjects(
  file = PROJECTS_FILE,
  { articlesDir = ARTICLES_DIR, staticDir = STATIC_DIR } = {}
) {
  if (!fs.existsSync(file)) return [];
  let projects;
  try {
    projects = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${file}: ${error.message}`);
  }
  if (!Array.isArray(projects)) {
    throw new Error(`${file} must contain an array of projects`);
  }

  const errors = projects.flatMap(validateProject);
  for (const project of projects) {
    if (
      project.article &&
      !fs.existsSync(path.join(articlesDir, project.article))
    ) {
      errors.push(`Project ${project.name}: article ${project.article} not found`);
    }
    if (project.image && !fs.existsSync(path.join(staticDir, project.image))) {
      errors.push(`Project ${project.name}: image ${project.image} not found`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid projects:\n${errors.join("\n")}`);
  }
  return projects;
}

function externalLink(url, label, className = "") {
  return `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(
    url
  )}" target="_blank" rel="noopener">${label}</a>`;
}

function projectCardHtml(project, root = "") {
  const links = [
    externalLink(
      project.url,
      escapeHtml(project.linkLabel || "Open"),
      "project__link project__link--primary"
    ),
  ];
  if (project.article) {
    links.push(
      `<a class="project__link" href="${root}${escapeHtml(
        project.article
      )}">Read the story</a>`
    );
  }
  if (project.source) {
    links.push(externalLink(project.source, "Source code", "project__link"));
  }

  const media = project.image
    ? `<a class="project__media" href="${escapeHtml(
        project.url
      )}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${root}${escapeHtml(
        project.image
      )}" alt="" /></a>`
    : "";

  return `
          <article class="project${project.image ? "" : " project--text"}">
            ${media}
            <div class="project__body">
              <h3 class="project__title">${escapeHtml(project.name)}</h3>
              ${
                project.platforms
                  ? `<p class="project__platforms meta">${escapeHtml(
                      project.platforms
                    )}</p>`
                  : ""
              }
              <p class="project__summary">${escapeHtml(project.summary)}</p>
              <p class="project__links">${links.join("")}</p>
            </div>
          </article>`;
}

function featuredProjectsHtml(projects, root = "") {
  const featured = projects.filter((project) => project.featured);
  if (featured.length === 0) return "";
  return enhanceImages(`
        <section class="showcase" aria-labelledby="showcase-heading">
          <div class="showcase__head">
            <h2 class="section-label" id="showcase-heading">Games I made</h2>
            <a class="showcase__all" href="${root}projects.html">All projects</a>
          </div>
          <div class="project-grid">${featured
            .map((project) => projectCardHtml(project, root))
            .join("")}
          </div>
        </section>`);
}

function generateProjectsHtml(projects) {
  const template = loadTemplate("projects");
  const canonicalUrl = `${BASE_URL}/projects.html`;
  const description =
    "Games, iPhone apps and websites by Robert Libsansky: free browser games written in C, offline iOS games without ads, and small web tools.";

  const sections = PROJECT_CATEGORIES.map(({ key, title }) => {
    const items = projects.filter((project) => project.category === key);
    if (items.length === 0) return "";
    return `
        <section class="project-group" aria-labelledby="projects-${key}">
          <h2 class="section-label" id="projects-${key}">${title}</h2>
          <div class="project-grid">${items
            .map((project) => projectCardHtml(project))
            .join("")}
          </div>
        </section>`;
  }).join("");

  return replaceTemplate(template, {
    ...commonReplacements(),
    ...headReplacements({
      title: "Projects",
      socialTitle: "Projects: games, apps and websites",
      description,
      canonicalUrl,
      socialKey: "projects",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `Projects - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: "en-US",
        author: authorSchema(),
      },
    }),
    "nav-projects-current": CURRENT_PAGE,
    projects: enhanceImages(sections),
  });
}

// ------------------------------------------------------------
// Standalone pages (pages/*.html): About and the like
// ------------------------------------------------------------

function getPageData(file, pagesDir = PAGES_DIR) {
  const raw = fs.readFileSync(path.join(pagesDir, file), "utf8");
  const { metadata, content } = extractMetadata(raw);
  const errors = [];
  if (!metadata.title) errors.push("Missing title");
  if (!metadata.description) errors.push("Missing description");
  if (!content) errors.push("Page content is empty");
  if (errors.length > 0) {
    throw new Error(`Page ${file} is invalid: ${errors.join(", ")}`);
  }
  return {
    ...metadata,
    content,
    filename: file,
    slug: path.basename(file, ".html"),
  };
}

function getAllPages(pagesDir = PAGES_DIR) {
  if (!fs.existsSync(pagesDir)) return [];
  return fs
    .readdirSync(pagesDir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => getPageData(file, pagesDir));
}

function generatePageHtml(page) {
  const template = loadTemplate("page");
  const canonicalUrl = `${BASE_URL}/${page.filename}`;
  const profile = page.schema === "profile";
  const jsonLd = profile
    ? {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        name: page.title,
        description: page.description,
        url: canonicalUrl,
        inLanguage: "en-US",
        mainEntity: authorSchema(),
      }
    : {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: page.title,
        description: page.description,
        url: canonicalUrl,
        inLanguage: "en-US",
        author: authorSchema(),
      };

  const navKey = `nav-${page.nav || page.slug}-current`;

  return replaceTemplate(template, {
    ...commonReplacements(),
    ...headReplacements({
      title: page.title,
      description: page.description,
      canonicalUrl,
      ogType: profile ? "profile" : "website",
      socialKey: page.slug,
      jsonLd,
    }),
    ...(navKey in commonReplacements() ? { [navKey]: CURRENT_PAGE } : {}),
    title: escapeHtml(page.title),
    lede: page.lede ? `<p class="page-head__lede">${escapeHtml(page.lede)}</p>` : "",
    content: enhanceImages(sanitizeHtml(page.content)),
  });
}

// ------------------------------------------------------------
// Home and archive
// ------------------------------------------------------------

const HOME_TITLE = `${config.site.title}: Small Software, Games and the Web`;

function generateIndexHtml(articles = null, projects = null) {
  const allArticles = articles || getAllArticles();
  const allProjects = projects || loadProjects();

  const recentArticles = allArticles.slice(0, RECENT_ARTICLES_COUNT);
  const articlesList = recentArticles
    .map((article) => postCardHtml(article))
    .join("");

  let archiveLink = "";
  if (allArticles.length > RECENT_ARTICLES_COUNT) {
    archiveLink =
      '<p class="list-footer"><a href="archive.html" class="button">View archive</a></p>';
  }

  return replaceTemplate(loadTemplate("index"), {
    ...commonReplacements(),
    ...headReplacements({
      title: HOME_TITLE,
      documentTitle: HOME_TITLE,
      description: config.site.description,
      canonicalUrl: BASE_URL,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: config.site.title,
        description: config.site.description,
        url: BASE_URL,
        inLanguage: "en-US",
        author: authorSchema(),
        publisher: authorSchema(),
      },
    }),
    articles: articlesList,
    archive: archiveLink,
    showcase: featuredProjectsHtml(allProjects),
  });
}


function generateArchiveHtml(articles = null) {
  const allArticles = articles || getAllArticles();

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
              <a href="${escapeHtml(article.filename)}">${
            isNote(article) ? '<span class="badge">Note</span> ' : ""
          }${escapeHtml(article.title)}</a>
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

  const canonicalUrl = `${BASE_URL}/archive.html`;
  const description = `Every post on ${config.site.title} by ${config.site.author}, by topic and by year: indie games in C and Swift, offline iPhone apps, web development and AI.`;

  return replaceTemplate(loadTemplate("archive"), {
    ...commonReplacements(),
    ...headReplacements({
      title: "Archive",
      socialTitle: `Archive - ${config.site.title}`,
      description,
      canonicalUrl,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `Archive - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: "en-US",
        author: authorSchema(),
      },
    }),
    "nav-archive-current": CURRENT_PAGE,
    topics: topicsHtml(collectTags(allArticles)),
    archive: archiveContent,
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

// ------------------------------------------------------------
// Articles
// ------------------------------------------------------------

const keywordCache = new WeakMap();

function keywordsOf(article) {
  if (!keywordCache.has(article)) {
    keywordCache.set(
      article,
      extractKeywords(article.content, article.title).toLowerCase().split(", ")
    );
  }
  return keywordCache.get(article);
}

// Shared tags count most; overlapping frequent words break ties and fill in
// for untagged articles. Falls back to the newest articles.
function getRelatedArticles(currentArticle, allArticles, maxCount = 3) {
  if (!currentArticle || !allArticles) return [];

  const currentTags = new Set((currentArticle.tags || []).map((t) => t.slug));
  const currentKeywords = keywordsOf(currentArticle);

  const others = allArticles.filter(
    (article) => article.filename !== currentArticle.filename
  );

  const scored = others
    .map((article) => {
      const tagScore = (article.tags || []).filter((tag) =>
        currentTags.has(tag.slug)
      ).length;
      const articleKeywords = keywordsOf(article);
      const keywordScore = currentKeywords.filter((keyword) =>
        articleKeywords.some(
          (ak) => ak.includes(keyword) || keyword.includes(ak)
        )
      ).length;
      return { article, tagScore, keywordScore };
    })
    .filter(({ tagScore, keywordScore }) => tagScore > 0 || keywordScore > 0)
    .sort(
      (a, b) =>
        b.tagScore - a.tagScore ||
        b.keywordScore - a.keywordScore ||
        compareNewestFirst(a.article, b.article)
    )
    .slice(0, maxCount)
    .map(({ article }) => article);

  if (scored.length === 0) {
    return [...others].sort(compareNewestFirst).slice(0, maxCount);
  }

  return scored;
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

const DISCUSSION_SITES = {
  "news.ycombinator.com": "Hacker News",
  "lobste.rs": "Lobsters",
  "x.com": "X",
  "twitter.com": "X",
  "bsky.app": "Bluesky",
  "itch.io": "itch.io",
};

// "Hacker News", "Lobsters", "r/gamedev" ... for a discussion URL
function discussionLabel(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  if (/(^|\.)reddit\.com$/.test(host)) {
    const sub = url.pathname.match(/^\/r\/([^/]+)/);
    return sub ? `r/${sub[1]}` : "Reddit";
  }
  return DISCUSSION_SITES[host] || host;
}

function discussionHtml(urls) {
  if (!urls || urls.length === 0) return "";
  const links = urls
    .map((url) =>
      externalLink(url, escapeHtml(discussionLabel(url)), "share__btn")
    )
    .join("");
  return `
          <div class="share discuss">
            <span class="meta share__label">Discuss</span>
            ${links}
          </div>`;
}

function sourceLinkHtml(article) {
  if (!article.link) return "";
  const host = new URL(article.link).hostname.replace(/^www\./, "");
  return `<p class="post__source">${externalLink(
    article.link,
    `<span class="post__source-label">Link</span> ${escapeHtml(host)}`,
    ""
  )}</p>`;
}

function articleSchema(article, { canonicalUrl, socialImage, wordCount, readingTime, keywords }) {
  const images = [`${BASE_URL}/${socialImage}`];
  if (article.image) images.push(`${BASE_URL}/${article.image}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title || "Untitled",
    description: article.description || "",
    url: canonicalUrl,
    image: images,
    datePublished: formatDateISO(article.date),
    dateModified: article.modified || formatDateISO(article.date),
    author: authorSchema(),
    publisher: authorSchema(),
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    inLanguage: "en-US",
    keywords,
    articleSection: (article.tags || [])[0]?.label,
    wordCount,
    timeRequired: `PT${readingTime}M`,
  };
}

function renderArticleHtml(article, articles) {
  const readingTime = estimateReadingTime(article.content);
  const tags = article.tags || [];
  const keywords =
    tags.length > 0
      ? tags.map((tag) => tag.label).join(", ")
      : extractKeywords(article.content, article.title);
  const wordCount = countWords(article.content);
  const canonicalUrl = `${BASE_URL}/${article.filename}`;
  const published = formatDateISO(article.date);
  const modified = article.modified || published;
  const socialImage = socialImageFile(article.slug);

  const extraMeta = [
    `<meta property="article:author" content="${BASE_URL}/about.html" />`,
    `<meta property="article:published_time" content="${published}" />`,
    `<meta property="article:modified_time" content="${modified}" />`,
    `<meta property="article:section" content="${escapeHtml(
      tags[0] ? tags[0].label : "Programming"
    )}" />`,
    ...tags.map(
      (tag) =>
        `<meta property="article:tag" content="${escapeHtml(tag.label)}" />`
    ),
  ].join("\n    ");

  const shareText = encodeURIComponent(article.title || "");
  const via = String(config.site.twitter || "").replace(/^@/, "");

  return replaceTemplate(loadTemplate("article"), {
    ...commonReplacements(),
    ...headReplacements({
      title: article.title || "Untitled",
      description: article.description,
      canonicalUrl,
      ogType: "article",
      socialKey: article.slug,
      extraMeta,
      jsonLd: articleSchema(article, {
        canonicalUrl,
        socialImage,
        wordCount,
        readingTime,
        keywords,
      }),
    }),
    title: escapeHtml(article.title || "Untitled"),
    "post-meta": postMetaHtml(article),
    content: enhanceImages(sanitizeHtml(article.content)),
    // Notes have no separate description: it is their opening text
    lede:
      article.description && !isNote(article)
        ? `<p class="post__lede">${escapeHtml(article.description)}</p>`
        : "",
    "post-tags":
      tags.length > 0
        ? `<p class="post__tags">${tagLinksHtml(tags)}</p>`
        : "",
    "source-link": sourceLinkHtml(article),
    discussion: discussionHtml(article.discuss),
    // Query-string values for the share links
    "share-url": encodeURIComponent(canonicalUrl),
    "share-title": shareText,
    "share-via": via ? `&amp;via=${encodeURIComponent(via)}` : "",
    "canonical-url": escapeHtml(canonicalUrl),
    "related-articles": generateRelatedArticlesHTML(
      getRelatedArticles(article, articles)
    ),
    navigation: generateArticleNavigation(article, articles),
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

function buildIndex(articles, projects = null) {
  const html = generateIndexHtml(articles, projects);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html);
}

function buildArchive(articles) {
  const html = generateArchiveHtml(articles);
  fs.writeFileSync(path.join(OUTPUT_DIR, "archive.html"), html);
}

function buildTags(articles) {
  const tags = collectTags(articles);
  if (tags.length === 0) return tags;
  ensureDir(path.join(OUTPUT_DIR, "tags"));
  for (const tag of tags) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, tagUrl(tag)),
      generateTagHtml(tag)
    );
  }
  return tags;
}

function buildPages(pages, articles) {
  const articleFiles = new Set(articles.map((article) => article.filename));
  const reserved = new Set(["index.html", "archive.html", "projects.html", "404.html"]);
  for (const page of pages) {
    if (articleFiles.has(page.filename) || reserved.has(page.filename)) {
      throw new Error(
        `Page ${page.filename} would overwrite another page of the site`
      );
    }
    fs.writeFileSync(
      path.join(OUTPUT_DIR, page.filename),
      generatePageHtml(page)
    );
  }
}

function buildProjects(projects) {
  if (projects.length === 0) return;
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "projects.html"),
    generateProjectsHtml(projects)
  );
}

// GitHub Pages serves 404.html for any missing path, including nested ones,
// so the template references assets through absolute URLs.
function generateNotFoundHtml() {
  return replaceTemplate(loadTemplate("404"), {
    ...commonReplacements(`${BASE_URL}/`),
  });
}

function buildNotFound() {
  const html = generateNotFoundHtml();
  fs.writeFileSync(path.join(OUTPUT_DIR, "404.html"), html);
}

// ------------------------------------------------------------
// Sitemap and feed
// ------------------------------------------------------------

const day = (iso) => iso.split("T")[0];

const newestDay = (days) =>
  days.length > 0
    ? days.reduce((a, b) => (a > b ? a : b))
    : day(new Date().toISOString());

// Every indexable page of the site, for the sitemap and IndexNow
function sitePages(articles, { pages = [], projects = [], pageDates = new Map() } = {}) {
  const articleLastmods = articles.map((article) =>
    day(article.modified || formatDateISO(article.date))
  );
  // Listing pages change exactly when some article does
  const listingLastmod = newestDay(articleLastmods);

  const entries = [
    { url: BASE_URL, lastmod: listingLastmod, changefreq: "daily", priority: 1.0 },
    {
      url: `${BASE_URL}/archive.html`,
      lastmod: listingLastmod,
      changefreq: "weekly",
      priority: 0.8,
    },
  ];

  if (projects.length > 0) {
    entries.push({
      url: `${BASE_URL}/projects.html`,
      lastmod: pageDates.get(PROJECTS_FILE),
      changefreq: "monthly",
      priority: 0.8,
    });
  }

  for (const page of pages) {
    entries.push({
      url: `${BASE_URL}/${page.filename}`,
      lastmod: pageDates.get(page.filename),
      changefreq: "monthly",
      priority: 0.7,
    });
  }

  for (const tag of collectTags(articles)) {
    entries.push({
      url: `${BASE_URL}/${tagUrl(tag)}`,
      lastmod: newestDay(
        tag.articles.map((article) =>
          day(article.modified || formatDateISO(article.date))
        )
      ),
      changefreq: "weekly",
      priority: 0.6,
    });
  }

  articles.forEach((article, index) => {
    entries.push({
      url: `${BASE_URL}/${article.filename}`,
      lastmod: articleLastmods[index],
      changefreq: "monthly",
      priority: 0.9,
    });
  });

  return entries;
}

function renderSitemap(articles, options = {}) {
  const sitemapItems = sitePages(articles, options);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapItems
  .map(
    (item) => `  <url>
    <loc>${item.url}</loc>${
      item.lastmod
        ? `
    <lastmod>${item.lastmod}</lastmod>`
        : ""
    }
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;
}

function generateSitemap(articles, options = {}) {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "sitemap.xml"),
    renderSitemap(articles, options)
  );
  console.log("✅ Sitemap generated");
}

const RSS_ITEMS = 20;

function cdata(text) {
  return `<![CDATA[${String(text).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

// Full article HTML as a feed reader shows it, with absolute URLs
function feedContent(article) {
  const url = `${BASE_URL}/${article.filename}`;
  let html = sanitizeHtml(article.content);
  if (article.link) {
    html = `<p>Link: <a href="${escapeHtml(article.link)}">${escapeHtml(
      article.link
    )}</a></p>\n${html}`;
  }
  return absolutizeUrls(html, url);
}

function renderRSSFeed(articles) {
  const recentArticles = articles.slice(0, RSS_ITEMS);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
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
      <content:encoded>${cdata(feedContent(article))}</content:encoded>
      <dc:creator>${escapeXml(config.site.author)}</dc:creator>
      <pubDate>${parseDate(article.date).toUTCString()}</pubDate>
      <guid isPermaLink="true">${BASE_URL}/${article.filename}</guid>${(
          article.tags || []
        )
          .map(
            (tag) => `
      <category>${escapeXml(tag.label)}</category>`
          )
          .join("")}
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

// ------------------------------------------------------------
// Social cards (generated by tools/og-images.js)
// ------------------------------------------------------------

const SOCIAL_CARD_TEMPLATE = path.join("tools", "og-card.html");
// Hash of what each card was generated from; kept out of static/ so it is
// not deployed
const SOCIAL_CARD_MANIFEST = path.join("tools", "og-cards.json");

// One card per page that has its own: articles, standalone pages, the
// projects page and every tag, plus the site-wide default card
function socialCardSpecs(articles, pages = [], projects = []) {
  const specs = [
    {
      file: DEFAULT_SOCIAL_IMAGE,
      title: "Small software, games and the web",
      eyebrow: "",
      image: null,
    },
    ...articles.map((article) => ({
      file: `${SOCIAL_CARDS_DIR}/${article.slug}.png`,
      title: article.title,
      eyebrow: isNote(article)
        ? "Note"
        : (article.tags || []).map((tag) => tag.label).slice(0, 3).join(" · "),
      image: article.image || null,
    })),
    ...pages.map((page) => ({
      file: `${SOCIAL_CARDS_DIR}/${page.slug}.png`,
      title: page.title,
      eyebrow: "",
      image: page.image ? stripLeadingSlash(page.image) : null,
    })),
    ...collectTags(articles).map((tag) => ({
      file: `${SOCIAL_CARDS_DIR}/tag-${tag.slug}.png`,
      title: `Articles about ${tag.label}`,
      eyebrow: "Topic",
      image: null,
    })),
  ];
  if (projects.length > 0) {
    const cover = projects.find((project) => project.featured && project.image);
    specs.push({
      file: `${SOCIAL_CARDS_DIR}/projects.png`,
      title: "Games, apps and websites I made",
      eyebrow: "Projects",
      image: cover ? cover.image : null,
    });
  }
  return specs;
}

// Changes when the card's text, image or the card design changes
function socialCardHash(spec, staticDir = STATIC_DIR) {
  const hash = require("crypto").createHash("sha256");
  hash.update(JSON.stringify([spec.title, spec.eyebrow, spec.image]));
  if (fs.existsSync(SOCIAL_CARD_TEMPLATE)) {
    hash.update(fs.readFileSync(SOCIAL_CARD_TEMPLATE));
  }
  if (spec.image && fs.existsSync(path.join(staticDir, spec.image))) {
    hash.update(fs.readFileSync(path.join(staticDir, spec.image)));
  }
  return hash.digest("hex").slice(0, 16);
}

function readSocialCardManifest(file = SOCIAL_CARD_MANIFEST) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {};
  }
}

// Cards that are missing or don't match their page any more
function staleSocialCards(
  specs,
  staticDir = STATIC_DIR,
  manifest = readSocialCardManifest()
) {
  return specs.filter(
    (spec) =>
      !fs.existsSync(path.join(staticDir, spec.file)) ||
      manifest[spec.file] !== socialCardHash(spec, staticDir)
  );
}

// Last commit day of files in a directory, for sitemap <lastmod>
function getFileDates(dir) {
  return new Map(
    [...getGitDates(dir)].map(([file, dates]) => [file, day(dates.modified)])
  );
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

    const pages = getAllPages();
    const projects = loadProjects();

    buildIndex(articles, projects);
    console.log("Generated index.html");

    buildArchive(articles);
    console.log("Generated archive.html");

    const tags = buildTags(articles);
    console.log(`Generated ${tags.length} tag pages`);

    buildProjects(projects);
    if (projects.length > 0) console.log("Generated projects.html");

    buildPages(pages, articles);
    pages.forEach((page) => console.log(`Generated: ${page.filename}`));

    buildNotFound();
    console.log("Generated 404.html");

    // Last commit days of the pages and projects.json, for <lastmod>
    const pageDates = new Map([
      ...getFileDates(PAGES_DIR),
      ...[...getFileDates(path.dirname(PROJECTS_FILE))].filter(
        ([file]) => file === path.basename(PROJECTS_FILE)
      ),
    ]);
    generateSitemap(articles, { pages, projects, pageDates });
    console.log("Generated sitemap.xml");

    generateRSSFeed(articles);
    console.log("Generated feed.xml");

    console.log(`\nBuild complete: ${articles.length} articles generated`);

    const staleCards = staleSocialCards(
      socialCardSpecs(articles, pages, projects)
    );
    if (staleCards.length > 0) {
      console.warn(
        `\n⚠️  ${staleCards.length} social cards are missing or out of date (pages fall back to the default card). Run: npm run og-images`
      );
      staleCards.forEach((spec) => console.warn(`   - ${spec.file}`));
    }

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
    getAllPages,
    getPageData,
    loadProjects,
    collectTags,
    slugify,
    parseTags,
    parseUrlList,
    isAllowedEmbedUrl,
    deriveDescription,
    enhanceImages,
    absolutizeUrls,
    discussionLabel,
    pageTitle,
    analyticsHtml,
    subscribeHtml,
    getRelatedArticles,
    generateTagHtml,
    generatePageHtml,
    generateProjectsHtml,
    sitePages,
    socialCardSpecs,
    socialCardHash,
    staleSocialCards,
    readSocialCardManifest,
    SOCIAL_CARD_MANIFEST,
    SOCIAL_CARD_TEMPLATE,
    SOCIAL_CARDS_DIR,
    buildTags,
    buildPages,
    buildProjects,
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
