const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { decodeEntities } = require("./html-entities");
const { LANGUAGES, DEFAULT_LANGUAGE, getLanguage } = require("./i18n");
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
    // 0 is a value, not a missing one
    if (value === undefined || value === null || value === "") {
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

const METADATA_COMMENT = /^<!--\s*([\w-]+):\s*(.+?)\s*-->$/;

// Metadata is the "<!-- key: value -->" comments at the top of the file,
// before any content. Comments further down are left in the content as they
// are, so a note like "<!-- todo: ... -->" in the middle of an article can
// never change its title or date.
function extractMetadata(content) {
  const metadata = {};
  const header = content.match(/^(?:\s*<!--[\s\S]*?-->)*/)[0];
  const rest = header.replace(/<!--[\s\S]*?-->/g, (comment) => {
    const match = comment.match(METADATA_COMMENT);
    if (!match) return comment;
    metadata[match[1].toLowerCase()] = match[2].trim();
    return "";
  });
  return { metadata, content: (rest + content.slice(header.length)).trim() };
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
// otherwise shift the day. `locale` is the page language's ("cs-CZ" gives
// "31. ledna 2026").
function formatDate(dateString, locale = DEFAULT_LANGUAGE.locale) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}`);
  }
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Compact form for the date column in list views ("Jan 31, 2026",
// "31. 1. 2026")
function formatDateShort(dateString, locale = DEFAULT_LANGUAGE.locale) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}`);
  }
  return date.toLocaleDateString(locale, {
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
// "web-development". "+" and "#" are spelled out, so "C", "C++" and "C#"
// stay three different tags ("c", "cpp", "csharp") instead of one.
function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\+\+/g, "pp")
    .replace(/\+/g, " plus ")
    .replace(/#/g, "sharp")
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

// Tags as shown in a language: their labels translated (language.tags), the
// slug (and so the tag page's file name) the same in every language. A
// translated label in the metadata ("Hry") is the same tag as its original
// ("Games").
function localizeTags(tags, lang) {
  const names = getLanguage(lang).tags || {};
  const bySlug = new Map();
  for (const [original, translated] of Object.entries(names)) {
    const tag = { label: translated, slug: slugify(original) };
    bySlug.set(slugify(original), tag);
    bySlug.set(slugify(translated), tag);
  }
  const seen = new Set();
  const result = [];
  for (const tag of tags || []) {
    const localized = bySlug.get(tag.slug) || tag;
    if (seen.has(localized.slug)) continue;
    seen.add(localized.slug);
    result.push({ ...localized });
  }
  return result;
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

// Pages the build generates itself; an article or standalone page of the
// same name would be silently overwritten by them
const RESERVED_PAGES = ["index.html", "archive.html", "projects.html", "404.html"];

// Dates are UTC midnight, and somewhere on Earth (UTC+14) the next calendar
// day starts 14 hours before it does in UTC
const FUTURE_DATE_TOLERANCE_MS = 14 * 60 * 60 * 1000;

// Article days are written as YYYY-MM-DD. Other formats would be parsed in
// the build machine's time zone (and so shown a day off) and would end up
// as invalid <time datetime> values.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Errors of a `date` or `updated` value; empty when it is a valid past day
function dayErrors(label, value) {
  if (!ISO_DAY.test(value) || isNaN(parseDate(value).getTime())) {
    return [`Invalid ${label} format: ${value} (use YYYY-MM-DD)`];
  }
  if (parseDate(value).getTime() - Date.now() > FUTURE_DATE_TOLERANCE_MS) {
    // A static site has no scheduled publishing: the post would go live
    // with the next deploy under a date that hasn't happened yet
    return [`${label[0].toUpperCase()}${label.slice(1)} ${value} is in the future`];
  }
  return [];
}

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
    errors.push(...dayErrors("date", article.date));
  }

  if (article.updated) {
    const updatedErrors = dayErrors("updated date", article.updated);
    errors.push(...updatedErrors);
    if (
      updatedErrors.length === 0 &&
      article.date &&
      ISO_DAY.test(article.date) &&
      article.updated < article.date
    ) {
      errors.push(
        `Updated date ${article.updated} is before the publication date ${article.date}`
      );
    }
  }

  if (!article.slug || article.slug.trim().length === 0) {
    errors.push("Missing or invalid slug");
  } else if (RESERVED_PAGES.includes(`${article.slug}.html`)) {
    errors.push(
      `File name ${article.slug}.html is taken by a page the build generates`
    );
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
    article.modified = getModifiedDate(article);
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
// instead of silently disappearing from the site. `lang` is the language of
// the articles in `articlesDir` (articles/ holds the default language's,
// articles/<dir>/ the others').
function getAllArticles(articlesDir = ARTICLES_DIR, lang = DEFAULT_LANGUAGE.code) {
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
      const article = getArticleData(file, articlesDir);
      article.lang = lang;
      article.tags = localizeTags(article.tags, lang);
      articles.push(article);
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

// A changed line that is only a metadata comment ("<!-- tags: Games -->") or
// blank: retitling or retagging an article doesn't change what it says
const isMetadataLine = (line) =>
  line.trim() === "" || METADATA_COMMENT.test(line.trim());

// Files of one commit's patch, each with whether the change went beyond
// metadata lines
function parsePatchFiles(patch) {
  const files = [];
  for (const section of patch.split(/^diff --git /m).slice(1)) {
    const lines = section.split("\n");
    const target =
      lines.find((line) => line.startsWith("+++ b/")) ||
      lines.find((line) => line.startsWith("--- a/"));
    // Header-only sections (mode changes, binary files) have no hunks
    const name = target
      ? target.slice(6)
      : (section.match(/^a\/(.+?) b\//) || [])[1];
    if (!name) continue;
    const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
    const changed =
      firstHunk === -1
        ? []
        : lines
            .slice(firstHunk)
            .filter((line) => /^[+-]/.test(line))
            .map((line) => line.slice(1));
    files.push({
      name,
      contentChanged:
        firstHunk === -1 ? true : !changed.every(isMetadataLine),
    });
  }
  return files;
}

// Parses `git log --format=%x00%aI -p --unified=0` output (newest first)
// into a map of file -> { created, modified }: its first commit, and the
// last commit that changed more than its metadata comments.
function parseGitDates(log) {
  const dates = new Map();
  for (const block of log.split("\0")) {
    const newline = block.indexOf("\n");
    const date = (newline === -1 ? block : block.slice(0, newline)).trim();
    if (!date) continue;
    for (const { name, contentChanged } of parsePatchFiles(
      block.slice(newline + 1)
    )) {
      if (!dates.has(name)) dates.set(name, { created: date, modified: null });
      const entry = dates.get(name);
      entry.created = date;
      if (contentChanged && !entry.modified) entry.modified = date;
    }
  }
  for (const entry of dates.values()) {
    if (!entry.modified) entry.modified = entry.created;
  }
  return dates;
}

// First and last commit dates of every file in a directory (or of `paths`
// in it), from a single `git log` call: the first commit orders articles
// published on the same day, the last one dates standalone pages and
// projects.json in the sitemap. Author dates are used, so rebasing changes
// nothing. Empty outside a git checkout or in a shallow clone (where history
// is cut off).
function getGitDates(dir = ARTICLES_DIR, paths = ["."]) {
  const git = (args) =>
    execFileSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });

  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      console.warn(
        "Shallow git clone: same-day articles are ordered by file name and pages get no sitemap <lastmod>"
      );
      return new Map();
    }
    return parseGitDates(
      git([
        "log",
        "--format=%x00%aI",
        "-p",
        "--unified=0",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        "--relative",
        "--",
        ...paths,
      ])
    );
  } catch (error) {
    return new Map();
  }
}

// When the article last changed in substance (sitemap <lastmod>, JSON-LD
// dateModified): its `updated` day, set by hand, or else its publication
// date. Not taken from git, where fixing typos or facts across old articles
// would present every one of them as freshly updated.
function getModifiedDate(article) {
  return formatDateISO(article.updated || article.date);
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
    text.replace(/&[a-z][a-z0-9]*;/gi, (entity) =>
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

// An opening tag. Quoted attribute values may contain ">", so they are
// skipped whole rather than ending the tag early.
const OPENING_TAG = /<[a-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^"'>])*>/gi;
// One attribute of a tag: the whitespace before it, its name and its value
const TAG_ATTRIBUTE =
  /(\s+)([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
// Attributes a browser loads or navigates to
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "poster",
  "data",
  "background",
  "cite",
]);

// Browsers ignore entities, whitespace and control characters when they
// look for the scheme ("jav&#x09;ascript:")
function isScriptUrl(value) {
  return /^(?:javascript|vbscript):/i.test(
    decodeEntities(value).replace(/[\u0000- ]+/g, "")
  );
}

// Drops event handlers (onclick, onerror ...) and javascript:/vbscript:
// URLs from one opening tag; everything else is left as written, so a link
// whose path merely contains "javascript:" keeps working.
function sanitizeTag(tag) {
  const nameEnd = tag.match(/^<[^\s/>]*/)[0].length;
  const attributes = tag
    .slice(nameEnd)
    .replace(TAG_ATTRIBUTE, (match, space, name, dq, sq, uq) => {
      const attribute = name.toLowerCase();
      const value = dq ?? sq ?? uq;
      if (/^on./.test(attribute)) return space;
      if (
        value !== undefined &&
        URL_ATTRIBUTES.has(attribute) &&
        isScriptUrl(value)
      ) {
        return space;
      }
      return match;
    });
  return tag.slice(0, nameEnd) + attributes;
}

function sanitizeHtml(html) {
  const result = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, "")
    .replace(
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gis,
      sanitizeIframe
    );
  return sanitizeEmbedBlocks(result).replace(OPENING_TAG, sanitizeTag);
}

// Words of text above an image beyond which it is unlikely to be in view
// when the page loads
const EAGER_IMAGE_MAX_WORDS_BEFORE = 100;

// Local images get their pixel size (no layout shift while loading) and
// lazy loading, except the first one (the first `eager` ones, for a grid
// whose first row is side by side) when it sits near the top of the content,
// where it is likely in view on load. A local image that doesn't exist fails
// the build. `root` is the page's relative path to the site root that local
// sources start with ("../images/..." on a page one level down).
function enhanceImages(
  html,
  staticDir = STATIC_DIR,
  { eager: eagerCount = 1, root = "" } = {}
) {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag, offset) => {
    let result = tag;
    const src = getAttribute(tag, "src");

    if (src && isLocalPath(src)) {
      const local = root && src.startsWith(root) ? src.slice(root.length) : src;
      const file = path.join(
        staticDir,
        stripLeadingSlash(local.split(/[?#]/)[0])
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
    const eager =
      index++ < eagerCount &&
      countWords(html.slice(0, offset)) <= EAGER_IMAGE_MAX_WORDS_BEFORE;
    if (!eager) result = addAttribute(result, "loading", "lazy");
    return result;
  });
}

// Code blocks that scroll sideways must be reachable from the keyboard
// (browsers before Chrome 130 don't make them focusable on their own)
function enhanceCodeBlocks(html) {
  return html.replace(/<pre\b[^>]*>/gi, (tag) =>
    addAttribute(tag, "tabindex", "0")
  );
}

// "800 / 582", "16/9" or "1.5"
const EMBED_RATIO = /^\s*\d+(?:\.\d+)?\s*(?:\/\s*\d+(?:\.\d+)?\s*)?$/;

// Click-to-play blocks get the game's shape up front (the --embed-ratio
// custom property the stage's aspect-ratio reads), so the poster already has
// the frame's size and the page doesn't jump when the game replaces it, with
// or without JavaScript. A malformed ratio fails the build; a missing one
// leaves the stylesheet's 16:9.
function enhanceEmbeds(html) {
  return html.replace(/<[a-z][^>]*\sdata-embed\s*=[^>]*>/gi, (tag) => {
    const ratio = getAttribute(tag, "data-embed-ratio");
    if (ratio === null) {
      console.warn(
        `Embed without data-embed-ratio, shown as 16:9: ${getAttribute(tag, "data-embed")}`
      );
      return tag;
    }
    if (!EMBED_RATIO.test(ratio)) {
      throw new Error(`Invalid data-embed-ratio "${ratio}" (use e.g. "800 / 582")`);
    }
    if (hasAttribute(tag, "style")) return tag;
    return addAttribute(tag, "style", `--embed-ratio: ${ratio.trim()}`);
  });
}

// Bullet lists are styled without list markers, which makes Safari stop
// announcing them as lists; the role keeps them lists for screen readers
function enhanceLists(html) {
  return html.replace(/<ul\b[^>]*>/gi, (tag) => addAttribute(tag, "role", "list"));
}

// Tables scroll sideways inside their own box on narrow screens instead of
// widening the page, and the box is focusable so the keyboard can scroll it
function enhanceTables(html) {
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (table) => `<div class="table-scroll" tabindex="0">${table}</div>`
  );
}

// Article and page bodies as shown on the site
function enhanceContent(html, staticDir = STATIC_DIR) {
  return enhanceTables(
    enhanceLists(
      enhanceEmbeds(
        enhanceCodeBlocks(enhanceImages(sanitizeHtml(html), staticDir))
      )
    )
  );
}

// Relative links and image sources resolved against the page URL, for
// content shown outside the site (RSS readers). Only attributes of real tags
// are rewritten, so code samples showing markup ("&lt;a href=...") stay as
// written.
function absolutizeUrls(html, pageUrl) {
  return html.replace(OPENING_TAG, (tag) =>
    tag.replace(
      /(\s(?:href|src)\s*=\s*)(["'])(.*?)\2/gi,
      (match, prefix, quote, value) => {
        if (
          !value ||
          /^[a-z][a-z0-9+.-]*:/i.test(value) ||
          value.startsWith("//")
        ) {
          return match;
        }
        return `${prefix}${quote}${new URL(value, pageUrl).href}${quote}`;
      }
    )
  );
}

// Relative links and image sources of a translation's content, which is
// written exactly like its original's: files from static/ ("images/...")
// live at the site root, not in the language's directory, and a page the
// language doesn't have (an untranslated article) is linked in the default
// language. Content in the default language is left as it is.
function localizeContentUrls(html, ctx, staticDir = STATIC_DIR) {
  if (ctx.lang === DEFAULT_LANGUAGE.code || ctx.root === ctx.home) return html;
  return html.replace(OPENING_TAG, (tag) =>
    tag.replace(
      /(\s(?:href|src|poster)\s*=\s*)(["'])(.*?)\2/gi,
      (match, prefix, quote, value) => {
        if (!isLocalPath(value) || /^(?:\/|\.\.\/)/.test(value)) return match;
        const target = decodeEntities(value).split(/[?#]/)[0];
        if (!target) return match;
        const file = path.join(staticDir, stripLeadingSlash(target));
        const isStatic = fs.existsSync(file) && fs.statSync(file).isFile();
        if (isStatic || pageHref(ctx, target) !== ctx.home + target) {
          return `${prefix}${quote}${ctx.root}${value}${quote}`;
        }
        return match;
      }
    )
  );
}

// Elements whose text is never retypeset (code keeps its spaces)
const VERBATIM_ELEMENTS = /^<(pre|code|script|style|textarea)\b/i;

// Czech typography: a one-letter preposition or conjunction (v, k, s, z, o,
// u, a, i) never ends a line, so the space after it becomes a non-breaking
// one. Only text between tags changes, never markup or code.
function typeset(html, lang) {
  if (getLanguage(lang).code !== "cs") return html;
  const parts = html.split(/(<[^>]*>)/);
  let verbatim = null;
  let afterInlineClose = false;
  return parts
    .map((part) => {
      if (part.startsWith("<")) {
        const name = (part.match(/^<\/?([a-z0-9]+)/i) || [])[1];
        if (verbatim) {
          if (name && name.toLowerCase() === verbatim && part.startsWith("</")) {
            verbatim = null;
          }
        } else {
          const open = part.match(VERBATIM_ELEMENTS);
          if (open && !part.endsWith("/>")) verbatim = open[1].toLowerCase();
        }
        // "</em>a" is a word ending in the emphasis, not the conjunction
        afterInlineClose = /^<\/(a|em|strong|b|i|span|code|abbr|mark|small|sub|sup)>$/i.test(part);
        return part;
      }
      if (verbatim) return part;
      // Text right after a tag starts a word, unless the tag closed an
      // inline element the word continues
      const before = afterInlineClose
        ? "(?<=[\\s(„‚\"'\\[–—])"
        : "(?<=^|[\\s(„‚\"'\\[–—])";
      return part
        .replace(
          new RegExp(`${before}([kKsSvVzZoOuUaAiI])[ \\t\\r\\n]+(?=\\S)`, "g"),
          "$1&nbsp;"
        )
        .replace(
          // A one-letter word right before a tag ("v <a ...>")
          new RegExp(`${before}([kKsSvVzZoOuUaAiI])[ \\t\\r\\n]+$`),
          "$1&nbsp;"
        )
        // Digit groups ("10 000"), "40 %", and a dash, which never starts
        // a line
        .replace(/(\d) (?=\d{3}(?!\d))/g, "$1&nbsp;")
        .replace(/(\d)[ \t]+%/g, "$1&nbsp;%")
        .replace(/[ \t\r\n]+(–|&ndash;)(?=[ \t\r\n])/g, "&nbsp;$1");
    })
    .join("");
}

// ------------------------------------------------------------
// Languages and URLs
// ------------------------------------------------------------

// Where a page of a language is, relative to the output directory and the
// site URL: "archive.html" -> "cs/archive.html"; "" is the language's home
function langPath(pagePath, lang) {
  const { dir } = getLanguage(lang);
  return dir ? `${dir}/${pagePath}` : pagePath;
}

// Absolute URL of a page of a language. The default language's home page is
// the bare site URL, as it has always been.
function pageUrl(pagePath = "", lang = DEFAULT_LANGUAGE.code) {
  const relative = langPath(pagePath, lang);
  return relative ? `${BASE_URL}/${relative}` : BASE_URL;
}

// What a page needs to know about where it is: its language, the relative
// path to the site root (`root`: static files) and to its language's root
// (`home`: its pages), and, from the build, which languages each page of the
// site exists in (`translations`: page path -> language codes). Pages
// rendered without `translations` link only within their own language.
function pageContext(pagePath = "", { lang, translations = null } = {}) {
  const language = getLanguage(lang);
  const depth = pagePath.split("/").length - 1;
  const langDepth = language.dir ? language.dir.split("/").length : 0;
  return {
    language,
    lang: language.code,
    pagePath,
    home: "../".repeat(depth),
    root: "../".repeat(depth + langDepth),
    translations,
  };
}

// Languages a page of the site exists in, in the order of LANGUAGES
function pageLanguages(ctx, pagePath = ctx.pagePath) {
  if (!ctx.translations) return [ctx.lang];
  return ctx.translations.get(pagePath) || [];
}

// Relative link from the current page to another page of the site: in the
// current page's language, or in the default language when this one doesn't
// have that page
function pageHref(ctx, pagePath) {
  if (!ctx.translations || ctx.lang === DEFAULT_LANGUAGE.code) {
    return ctx.home + pagePath;
  }
  const langs = pageLanguages(ctx, pagePath);
  return langs.includes(ctx.lang) || !langs.includes(DEFAULT_LANGUAGE.code)
    ? ctx.home + pagePath
    : ctx.root + pagePath;
}

// Languages the built site has (those with a home page)
function siteLanguages(ctx) {
  return ctx.translations
    ? LANGUAGES.filter((language) =>
        pageLanguages(ctx, "").includes(language.code)
      )
    : [ctx.language];
}

// hreflang links to every language version of the page, the default
// language's also as x-default. Nothing for a page in one language only.
function alternateLinksHtml(ctx) {
  const langs = pageLanguages(ctx);
  if (langs.length < 2) return "";
  const link = (hreflang, code) =>
    `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(
      pageUrl(ctx.pagePath, code)
    )}" />`;
  return [
    ...langs.map((code) => link(code, code)),
    ...(langs.includes(DEFAULT_LANGUAGE.code)
      ? [link("x-default", DEFAULT_LANGUAGE.code)]
      : []),
  ].join("\n    ");
}

function ogLocaleAlternatesHtml(ctx) {
  return pageLanguages(ctx)
    .filter((code) => code !== ctx.lang)
    .map(
      (code) =>
        `<meta property="og:locale:alternate" content="${getLanguage(code).ogLocale}" />`
    )
    .join("\n    ");
}

// Links to the page in the site's other languages, or to their home pages
// when the page isn't translated
function otherLanguageLinks(ctx) {
  const langs = pageLanguages(ctx);
  return siteLanguages(ctx)
    .filter((language) => language.code !== ctx.lang)
    .map((language) => ({
      language,
      href: pageUrl(langs.includes(language.code) ? ctx.pagePath : "", language.code),
    }));
}

// The header's language switch: the other language's code, named in it
function languageSwitchHtml(ctx) {
  return otherLanguageLinks(ctx)
    .map(
      ({ language, href }) =>
        `<a class="lang-switch" href="${escapeHtml(href)}" hreflang="${
          language.code
        }" lang="${language.code}" title="${escapeHtml(language.name)}">${escapeHtml(
          language.short
        )}</a>`
    )
    .join("\n          ");
}

// The footer's language links, by the languages' own names
function footerLanguagesHtml(ctx) {
  return otherLanguageLinks(ctx)
    .map(
      ({ language, href }) =>
        `<a href="${escapeHtml(href)}" hreflang="${language.code}" lang="${
          language.code
        }">${escapeHtml(language.name)}</a>`
    )
    .join("\n          ");
}

// Text in languages with letters outside Latin-1 (Czech ě, š, ř ...) needs
// the latin-ext font files from the first paint
function fontPreloadsHtml(ctx) {
  if (ctx.lang === DEFAULT_LANGUAGE.code) return "";
  return ["inter-latin-ext.woff2", "source-serif-4-latin-ext.woff2"]
    .map(
      (font) =>
        `<link rel="preload" href="${ctx.root}fonts/${font}" as="font" type="font/woff2" crossorigin />`
    )
    .join("\n    ");
}

// ------------------------------------------------------------
// Shared page parts
// ------------------------------------------------------------

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
// to action. `home` leads to the language's own feed.
function subscribeHtml(
  home = "",
  newsletter = config.newsletter,
  lang = DEFAULT_LANGUAGE.code
) {
  const text = getLanguage(lang).subscribe;
  const user = newsletter && newsletter.buttondown;
  const rss = `<a href="${home}feed.xml">RSS</a>`;
  const xUrl = twitterProfileUrl();
  const xLink = xUrl
    ? text.xLink(
        `<a href="${escapeHtml(xUrl)}" target="_blank" rel="noopener">${escapeHtml(config.site.twitter)}</a>`
      )
    : "";

  if (user) {
    if (!/^[\w-]+$/.test(user)) {
      throw new Error(`Invalid Buttondown username: ${user}`);
    }
    return `
        <section class="subscribe" aria-labelledby="subscribe-title">
          <h2 class="subscribe__title" id="subscribe-title">${text.emailTitle}</h2>
          <p class="subscribe__text">
            ${text.emailText}
          </p>
          <form class="subscribe__form" action="https://buttondown.com/api/emails/embed-subscribe/${user}" method="post" target="_blank">
            <label class="visually-hidden" for="subscribe-email">${text.emailLabel}</label>
            <input class="subscribe__input" type="email" name="email" id="subscribe-email" placeholder="${text.emailPlaceholder}" autocomplete="email" required />
            <input type="hidden" name="embed" value="1" />
            <button class="button button--accent" type="submit">${text.emailButton}</button>
          </form>
          <p class="subscribe__alt meta">${text.emailAlt(rss, xLink)}</p>
        </section>`;
  }

  return `
        <section class="subscribe" aria-labelledby="subscribe-title">
          <h2 class="subscribe__title" id="subscribe-title">${text.rssTitle}</h2>
          <p class="subscribe__text">
            ${text.rssText(rss, xLink)}
          </p>
          <p class="subscribe__actions">
            <a class="button button--accent" href="${home}feed.xml">${text.rssButton}</a>
          </p>
        </section>`;
}

// Placeholders shared by every page template, for the page described by
// `ctx` (pageContext): `root` prefixes asset links and `home` page links
// (both empty, i.e. relative, at the top level of the default language;
// "../" a level deeper; the absolute site URL on the 404 page), and
// {{t.<key>}} is the page language's text (i18n.js).
function commonReplacements(ctx = pageContext()) {
  const { language, root, home } = ctx;
  return {
    "base-url": BASE_URL,
    "home-url": escapeHtml(pageUrl("", ctx.lang)),
    root,
    home,
    lang: language.code,
    "og-locale": language.ogLocale,
    "og-locale-alternates": ogLocaleAlternatesHtml(ctx),
    alternates: alternateLinksHtml(ctx),
    "language-switch": languageSwitchHtml(ctx),
    "footer-languages": footerLanguagesHtml(ctx),
    "font-preloads": fontPreloadsHtml(ctx),
    "site-title": escapeHtml(config.site.title),
    // The site name as shown in the header, with a typographic apostrophe
    "wordmark-text": escapeHtml(config.site.title).replace(/&#039;/g, "&rsquo;"),
    author: escapeHtml(language.author),
    twitter: escapeHtml(config.site.twitter || ""),
    year: new Date().getFullYear(),
    analytics: analyticsHtml(),
    subscribe: subscribeHtml(home, config.newsletter, ctx.lang),
    "footer-profiles": footerProfilesHtml(),
    // Marks the current page in the header navigation
    "nav-archive-current": "",
    "nav-projects-current": "",
    "nav-about-current": "",
    ...Object.fromEntries(
      Object.entries(language.ui).map(([key, value]) => [
        `t.${key}`,
        typeset(value, language.code),
      ])
    ),
  };
}

// The author's profiles marked `footer: true` in config.site.profiles
function footerProfilesHtml(profiles = config.site.profiles || []) {
  return profiles
    .filter((profile) => profile.footer)
    .map((profile) => externalLink(profile.url, escapeHtml(profile.name)))
    .join("\n          ");
}

const CURRENT_PAGE = ' aria-current="page"';
// A page inside a section (a tag page in the archive) rather than the
// section's own page
const CURRENT_SECTION = ' aria-current="true"';

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

// The site-wide card of a language: og-image.png, og-image-cs.png ...
function defaultSocialImage(lang = DEFAULT_LANGUAGE.code) {
  const language = getLanguage(lang);
  return language === DEFAULT_LANGUAGE
    ? DEFAULT_SOCIAL_IMAGE
    : DEFAULT_SOCIAL_IMAGE.replace(/\.png$/, `-${language.code}.png`);
}

// Key of a page's own card: its slug, under the language's directory for
// the other languages (og/cs/<slug>.png)
function socialKey(key, lang = DEFAULT_LANGUAGE.code) {
  return langPath(key, lang);
}

// The page's own generated card (og/<key>.png) when it exists, otherwise
// the language's site-wide card, otherwise the default language's
function socialImageFile(key, staticDir = STATIC_DIR, lang = DEFAULT_LANGUAGE.code) {
  if (key) {
    const card = `${SOCIAL_CARDS_DIR}/${key}.png`;
    if (fs.existsSync(path.join(staticDir, card))) return card;
  }
  const fallback = defaultSocialImage(lang);
  return fs.existsSync(path.join(staticDir, fallback))
    ? fallback
    : DEFAULT_SOCIAL_IMAGE;
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
  lang = DEFAULT_LANGUAGE.code,
}) {
  const imageFile = socialImageFile(socialKey, STATIC_DIR, lang);
  const defaultCardLang = LANGUAGES.find(
    (language) => defaultSocialImage(language.code) === imageFile
  );
  const alt = defaultCardLang
    ? defaultCardLang.defaultSocialAlt
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

function tagUrl(tag, home = "") {
  return `${home}tags/${tag.slug}.html`;
}

function tagLinksHtml(tags, home = "", className = "tag") {
  return (tags || [])
    .map(
      (tag) =>
        `<a class="${className}" href="${tagUrl(tag, home)}">${escapeHtml(
          tag.label
        )}</a>`
    )
    .join("");
}

const isNote = (article) => article.type === "note";

// Language of an article (the default one for articles loaded on their own)
const articleLanguage = (article) => getLanguage(article.lang);

// Eyebrow line of an article in lists and on its page. On its own page
// (`updated`), an article updated since publication shows that day too.
function postMetaHtml(article, { long = true, updated = false } = {}) {
  const language = articleLanguage(article);
  const parts = [];
  if (isNote(article)) {
    parts.push(`<span class="badge">${language.note}</span>`);
  }
  parts.push(
    `<time datetime="${escapeHtml(article.date)}">${
      long
        ? formatDate(article.date, language.locale)
        : formatDateShort(article.date, language.locale)
    }</time>`
  );
  if (!isNote(article)) {
    parts.push(
      `<span>${language.minRead(estimateReadingTime(article.content))}</span>`
    );
  }
  if (updated && article.updated && article.updated !== article.date) {
    parts.push(
      `<span class="post__updated">${language.updated} <time datetime="${escapeHtml(article.updated)}">${formatDate(
        article.updated,
        language.locale
      )}</time></span>`
    );
  }
  return parts.join('<span class="dot" aria-hidden="true"></span>');
}

// `heading` is the level of the card's title: h2 directly under the page's
// h1, h3 inside a titled section. `home` leads to the language's pages.
function postCardHtml(article, home = "", heading = "h2") {
  const tags = article.tags || [];
  return `
        <article class="post-card${isNote(article) ? " post-card--note" : ""}">
          <p class="eyebrow post-card__meta">${postMetaHtml(article)}</p>
          <${heading} class="post-card__title">
            <a href="${home}${escapeHtml(article.filename)}">${typeset(
    escapeHtml(article.title),
    article.lang
  )}</a>
          </${heading}>
          ${
            article.description
              ? `<p class="post-card__excerpt">${typeset(
                  escapeHtml(article.description),
                  article.lang
                )}</p>`
              : ""
          }
          ${
            tags.length > 0
              ? `<p class="post-card__tags">${tagLinksHtml(tags, home)}</p>`
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

function topicsHtml(tags, home = "", lang = DEFAULT_LANGUAGE.code) {
  if (tags.length === 0) return "";
  const language = getLanguage(lang);
  const items = tags
    .map(
      (tag) =>
        `<li><a class="tag" href="${tagUrl(tag, home)}">${escapeHtml(
          tag.label
        )}<span class="tag__count" aria-hidden="true">${
          tag.articles.length
        }</span><span class="visually-hidden"> (${language.postCount(
          tag.articles.length
        )})</span></a></li>`
    )
    .join("");
  return `
        <section class="topics" aria-labelledby="topics-heading">
          <h2 class="section-label" id="topics-heading">${language.topics}</h2>
          <ul class="tag-cloud" role="list">${items}</ul>
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

// A tag's language is its articles'
const tagLanguage = (tag) => articleLanguage(tag.articles[0] || {});

function tagDescription(tag) {
  const language = tagLanguage(tag);
  const count = tag.articles.length;
  const titles = tag.articles.map((article) => article.title).join("; ");
  let text = `${language.tagDescription(
    count,
    tag.label,
    language.author
  )}: ${titles}`;
  // One title alone makes a thin description; the post's own summary
  // fills it out
  const [only] = tag.articles;
  if (count === 1 && only.description) {
    text += `. ${only.description}`;
  }
  return truncateText(text, 160);
}

function generateTagHtml(tag, { translations = null } = {}) {
  const template = loadTemplate("tag");
  const language = tagLanguage(tag);
  const ctx = pageContext(tagUrl(tag), { lang: language.code, translations });
  const canonicalUrl = pageUrl(tagUrl(tag), language.code);
  const count = tag.articles.length;
  const description = tagDescription(tag);
  // The label alone ("C", "AI") says too little in a search result or a tab
  const title = language.tagTitle(tag.label);

  return replaceTemplate(template, {
    ...commonReplacements(ctx),
    ...headReplacements({
      title,
      description,
      canonicalUrl,
      socialKey: socialKey(`tag-${tag.slug}`, language.code),
      lang: language.code,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${title} - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: language.locale,
        author: authorSchema(),
      },
    }),
    "nav-archive-current": CURRENT_SECTION,
    "tag-label": escapeHtml(tag.label),
    "tag-summary": language.tagSummary(count),
    articles: tag.articles
      .map((article) => postCardHtml(article, ctx.home))
      .join(""),
  });
}

// ------------------------------------------------------------
// Projects (projects.json): the Projects page and the home page showcase
// ------------------------------------------------------------

// Their headings are in each language's projectCategories (i18n.js)
const PROJECT_CATEGORIES = [{ key: "games" }, { key: "apps" }, { key: "web" }];

// Fields a project's `translations` may give for another language:
// "translations": { "cs": { "summary": "...", "linkLabel": "..." } }
const TRANSLATED_PROJECT_FIELDS = ["name", "summary", "linkLabel", "platforms"];

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
  if (project.translations !== undefined) {
    const translations = project.translations;
    if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
      errors.push(`Project ${label}: translations must be an object by language`);
    } else {
      for (const [code, fields] of Object.entries(translations)) {
        if (!LANGUAGES.some((language) => language.code === code)) {
          errors.push(`Project ${label}: unknown language "${code}" in translations`);
          continue;
        }
        for (const [key, value] of Object.entries(fields || {})) {
          if (!TRANSLATED_PROJECT_FIELDS.includes(key) || typeof value !== "string") {
            errors.push(
              `Project ${label}: translations.${code}.${key} is not a translatable text (${TRANSLATED_PROJECT_FIELDS.join(", ")})`
            );
          }
        }
      }
    }
  }
  return errors;
}

// A project as shown in a language: its translated fields over the original
function localizeProject(project, lang = DEFAULT_LANGUAGE.code) {
  const { translations, ...rest } = project;
  return { ...rest, ...((translations && translations[lang]) || {}) };
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
    // Already reported by validateProject
    if (!project || typeof project !== "object") continue;
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
  // Images are paths inside static/ like an article's, with or without a
  // leading slash; pages link them relative to their own location
  return projects.map((project) =>
    project.image
      ? { ...project, image: stripLeadingSlash(project.image) }
      : project
  );
}

function externalLink(url, label, className = "") {
  return `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(
    url
  )}" target="_blank" rel="noopener">${label}</a>`;
}

// `ctx` (pageContext) is the page the card is on: its language, and where
// the images (`root`) and the project's article are
function projectCardHtml(project, ctx = pageContext()) {
  const language = ctx.language;
  const links = [
    externalLink(
      project.url,
      escapeHtml(project.linkLabel || language.openProject),
      "project__link project__link--primary"
    ),
  ];
  if (project.article) {
    links.push(
      `<a class="project__link" href="${escapeHtml(
        pageHref(ctx, project.article)
      )}">${language.readStory}</a>`
    );
  }
  if (project.source) {
    links.push(
      externalLink(project.source, language.sourceCode, "project__link")
    );
  }

  const media = project.image
    ? `<a class="project__media" href="${escapeHtml(
        project.url
      )}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${ctx.root}${escapeHtml(
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
              <p class="project__summary">${typeset(
                escapeHtml(project.summary),
                ctx.lang
              )}</p>
              <p class="project__links">${links.join("")}</p>
            </div>
          </article>`;
}

// Cards per row of .project-grid on wide screens (styles.css): the pictures
// of the whole first row are in view when the page opens
const PROJECT_GRID_COLUMNS = 2;

// Project images are linked relative to the page (ctx.root) and sized from
// static/
function enhanceProjectImages(html, ctx) {
  return enhanceImages(html, STATIC_DIR, {
    eager: PROJECT_GRID_COLUMNS,
    root: ctx.root,
  });
}

function featuredProjectsHtml(projects, ctx = pageContext()) {
  const featured = projects.filter((project) => project.featured);
  if (featured.length === 0) return "";
  return enhanceProjectImages(
    `
        <section class="showcase" aria-labelledby="showcase-heading">
          <div class="showcase__head">
            <h2 class="section-label" id="showcase-heading">${ctx.language.showcase}</h2>
            <a class="showcase__all" href="${ctx.home}projects.html">${ctx.language.allProjects}</a>
          </div>
          <div class="project-grid">${featured
            .map((project) => projectCardHtml(localizeProject(project, ctx.lang), ctx))
            .join("")}
          </div>
        </section>`,
    ctx
  );
}

function generateProjectsHtml(
  projects,
  { lang = DEFAULT_LANGUAGE.code, translations = null } = {}
) {
  const template = loadTemplate("projects");
  const ctx = pageContext("projects.html", { lang, translations });
  const language = ctx.language;
  const canonicalUrl = pageUrl("projects.html", lang);
  const description = language.projectsDescription(language.author);

  const sections = PROJECT_CATEGORIES.map(({ key }) => {
    const items = projects.filter((project) => project.category === key);
    if (items.length === 0) return "";
    return `
        <section class="project-group" aria-labelledby="projects-${key}">
          <h2 class="section-label" id="projects-${key}">${language.projectCategories[key]}</h2>
          <div class="project-grid">${items
            .map((project) => projectCardHtml(localizeProject(project, lang), ctx))
            .join("")}
          </div>
        </section>`;
  }).join("");

  return replaceTemplate(template, {
    ...commonReplacements(ctx),
    ...headReplacements({
      title: language.projectsTitle,
      socialTitle: language.projectsSocialTitle,
      description,
      canonicalUrl,
      socialKey: socialKey("projects", lang),
      lang,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${language.projectsTitle} - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: language.locale,
        author: authorSchema(),
      },
    }),
    "nav-projects-current": CURRENT_PAGE,
    projects: enhanceProjectImages(sections, ctx),
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

// `lang` is the language of the pages in `pagesDir` (pages/ holds the
// default language's, pages/<dir>/ the others')
function getAllPages(pagesDir = PAGES_DIR, lang = DEFAULT_LANGUAGE.code) {
  if (!fs.existsSync(pagesDir)) return [];
  return fs
    .readdirSync(pagesDir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => ({ ...getPageData(file, pagesDir), lang }));
}

// An article's or page's body as shown on its page: enhanced, with links
// resolved for its language and typeset for it
function renderContent(html, ctx) {
  return typeset(localizeContentUrls(enhanceContent(html), ctx), ctx.lang);
}

function generatePageHtml(page, { translations = null } = {}) {
  const template = loadTemplate("page");
  const ctx = pageContext(page.filename, { lang: page.lang, translations });
  const language = ctx.language;
  const canonicalUrl = pageUrl(page.filename, ctx.lang);
  const profile = page.schema === "profile";
  const jsonLd = profile
    ? {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        name: page.title,
        description: page.description,
        url: canonicalUrl,
        inLanguage: language.locale,
        mainEntity: authorSchema(),
      }
    : {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: page.title,
        description: page.description,
        url: canonicalUrl,
        inLanguage: language.locale,
        author: authorSchema(),
      };

  const navKey = `nav-${page.nav || page.slug}-current`;
  const common = commonReplacements(ctx);

  return replaceTemplate(template, {
    ...common,
    ...headReplacements({
      title: page.title,
      description: page.description,
      canonicalUrl,
      ogType: profile ? "profile" : "website",
      socialKey: socialKey(page.slug, ctx.lang),
      lang: ctx.lang,
      jsonLd,
    }),
    ...(navKey in common ? { [navKey]: CURRENT_PAGE } : {}),
    title: typeset(escapeHtml(page.title), ctx.lang),
    lede: page.lede
      ? `<p class="page-head__lede">${typeset(escapeHtml(page.lede), ctx.lang)}</p>`
      : "",
    content: renderContent(page.content, ctx),
  });
}

// ------------------------------------------------------------
// Home and archive
// ------------------------------------------------------------

// Language of a listing page: the one asked for, or its articles'
function listingLanguage(lang, articles) {
  return lang || (articles && articles[0] && articles[0].lang) || DEFAULT_LANGUAGE.code;
}

function generateIndexHtml(
  articles = null,
  projects = null,
  { lang = null, translations = null } = {}
) {
  const allArticles = articles || getAllArticles();
  const allProjects = projects || loadProjects();
  const ctx = pageContext("", {
    lang: listingLanguage(lang, allArticles),
    translations,
  });
  const language = ctx.language;
  const homeTitle = language.homeTitle;
  const homeUrl = pageUrl("", ctx.lang);

  const recentArticles = allArticles.slice(0, RECENT_ARTICLES_COUNT);
  const articlesList = recentArticles
    .map((article) => postCardHtml(article, "", "h3"))
    .join("");

  let archiveLink = "";
  if (allArticles.length > RECENT_ARTICLES_COUNT) {
    archiveLink = `<p class="list-footer"><a href="archive.html" class="button">${language.viewArchive}</a></p>`;
  }

  return replaceTemplate(loadTemplate("index"), {
    ...commonReplacements(ctx),
    ...headReplacements({
      title: homeTitle,
      documentTitle: homeTitle,
      description: language.siteDescription,
      canonicalUrl: homeUrl,
      lang: ctx.lang,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: config.site.title,
        description: language.siteDescription,
        url: homeUrl,
        inLanguage: language.locale,
        author: authorSchema(),
        publisher: authorSchema(),
      },
    }),
    articles: articlesList,
    archive: archiveLink,
    showcase: featuredProjectsHtml(allProjects, ctx),
  });
}


function generateArchiveHtml(
  articles = null,
  { lang = null, translations = null } = {}
) {
  const allArticles = articles || getAllArticles();
  const ctx = pageContext("archive.html", {
    lang: listingLanguage(lang, allArticles),
    translations,
  });
  const language = ctx.language;

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
            isNote(article)
              ? `<span class="badge">${language.note}</span> `
              : ""
          }${typeset(escapeHtml(article.title), ctx.lang)}</a>
              <time datetime="${escapeHtml(
                article.date
              )}">${formatDateShort(article.date, language.locale)}</time>
            </li>
          `
        )
        .join("");

      return `
        <section class="archive-year">
          <h2 class="section-label archive-year__label">${year}</h2>
          <ul class="archive-list" role="list">
            ${yearArticles}
          </ul>
        </section>
      `;
    })
    .join("");

  const canonicalUrl = pageUrl("archive.html", ctx.lang);
  const description = language.archiveDescription(language.author);

  return replaceTemplate(loadTemplate("archive"), {
    ...commonReplacements(ctx),
    ...headReplacements({
      title: language.archiveTitle,
      socialTitle: `${language.archiveTitle} - ${config.site.title}`,
      description,
      canonicalUrl,
      lang: ctx.lang,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${language.archiveTitle} - ${config.site.title}`,
        description,
        url: canonicalUrl,
        inLanguage: language.locale,
        author: authorSchema(),
      },
    }),
    "nav-archive-current": CURRENT_PAGE,
    topics: topicsHtml(collectTags(allArticles), "", ctx.lang),
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

// A translation's related reading mirrors its original's (the same
// articles, in this language, where translated), so both language versions
// point readers the same way. Articles without an original (or whose
// original's picks aren't translated) get their own.
function relatedArticlesFor(article, articles, originals = null) {
  if (originals && article.lang && article.lang !== DEFAULT_LANGUAGE.code) {
    const original = originals.find((item) => item.filename === article.filename);
    if (original) {
      const translated = new Map(articles.map((item) => [item.filename, item]));
      const mirrored = getRelatedArticles(original, originals, originals.length)
        .map((item) => translated.get(item.filename))
        .filter(Boolean)
        .slice(0, 3);
      if (mirrored.length > 0) return mirrored;
    }
  }
  return getRelatedArticles(article, articles);
}

function generateRelatedArticlesHTML(relatedArticles, lang = DEFAULT_LANGUAGE.code) {
  if (!relatedArticles || relatedArticles.length === 0) {
    return "";
  }
  const language = getLanguage(lang);

  const articlesList = relatedArticles
    .map(
      (article) => `
      <li>
        <a href="${escapeHtml(article.filename)}">${typeset(
        escapeHtml(article.title),
        lang
      )}</a>
        <time datetime="${escapeHtml(article.date)}">${formatDateShort(
        article.date,
        language.locale
      )}</time>
      </li>
    `
    )
    .join("");

  return `
    <section class="related">
      <h2 class="section-label">${language.related}</h2>
      <ul class="related__list" role="list">
        ${articlesList}
      </ul>
    </section>
  `;
}

function generateArticleNavigation(currentArticle, allArticles) {
  const language = articleLanguage(currentArticle);
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
          <span class="post-nav__title">${typeset(
            escapeHtml(article.title),
            language.code
          )}</span>
        </a>
  `;

  return `
      <nav class="post-nav" aria-label="${language.moreArticles}">
        ${prevArticle ? item(prevArticle, "prev", language.previous) : ""}
        ${nextArticle ? item(nextArticle, "next", language.next) : ""}
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

function discussionHtml(urls, lang = DEFAULT_LANGUAGE.code) {
  if (!urls || urls.length === 0) return "";
  const links = urls
    .map((url) =>
      externalLink(url, escapeHtml(discussionLabel(url)), "share__btn")
    )
    .join("");
  return `
          <div class="share discuss">
            <span class="meta share__label">${getLanguage(lang).discuss}</span>
            ${links}
          </div>`;
}

function sourceLinkHtml(article) {
  if (!article.link) return "";
  const host = new URL(article.link).hostname.replace(/^www\./, "");
  return `<p class="post__source">${externalLink(
    article.link,
    `<span class="post__source-label">${articleLanguage(article).link}</span> ${escapeHtml(host)}`,
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
    inLanguage: articleLanguage(article).locale,
    keywords,
    articleSection: (article.tags || [])[0]?.label,
    wordCount,
    timeRequired: `PT${readingTime}M`,
  };
}

// `translations` (page path -> languages, from the build) links the other
// language versions; `originals` (the default language's articles) gives a
// translation its original's related reading
function renderArticleHtml(
  article,
  articles,
  { translations = null, originals = null } = {}
) {
  const ctx = pageContext(article.filename, { lang: article.lang, translations });
  const readingTime = estimateReadingTime(article.content);
  const tags = article.tags || [];
  const keywords =
    tags.length > 0
      ? tags.map((tag) => tag.label).join(", ")
      : extractKeywords(article.content, article.title);
  const wordCount = countWords(article.content);
  const canonicalUrl = pageUrl(article.filename, ctx.lang);
  const published = formatDateISO(article.date);
  const modified = article.modified || published;
  const cardKey = socialKey(article.slug, ctx.lang);
  const socialImage = socialImageFile(cardKey, STATIC_DIR, ctx.lang);

  // An untagged article has no section rather than a made-up one
  const extraMeta = [
    `<meta property="article:author" content="${BASE_URL}/about.html" />`,
    `<meta property="article:published_time" content="${published}" />`,
    `<meta property="article:modified_time" content="${modified}" />`,
    ...(tags[0]
      ? [
          `<meta property="article:section" content="${escapeHtml(
            tags[0].label
          )}" />`,
        ]
      : []),
    ...tags.map(
      (tag) =>
        `<meta property="article:tag" content="${escapeHtml(tag.label)}" />`
    ),
  ].join("\n    ");

  const shareText = encodeURIComponent(article.title || "");
  const via = String(config.site.twitter || "").replace(/^@/, "");

  return replaceTemplate(loadTemplate("article"), {
    ...commonReplacements(ctx),
    ...headReplacements({
      title: article.title || "Untitled",
      description: article.description,
      canonicalUrl,
      ogType: "article",
      socialKey: cardKey,
      lang: ctx.lang,
      extraMeta,
      jsonLd: articleSchema(article, {
        canonicalUrl,
        socialImage,
        wordCount,
        readingTime,
        keywords,
      }),
    }),
    title: typeset(escapeHtml(article.title || "Untitled"), ctx.lang),
    "post-meta": postMetaHtml(article, { updated: true }),
    content: renderContent(article.content, ctx),
    // Notes have no separate description: it is their opening text
    lede:
      article.description && !isNote(article)
        ? `<p class="post__lede">${typeset(
            escapeHtml(article.description),
            ctx.lang
          )}</p>`
        : "",
    "post-tags":
      tags.length > 0
        ? `<p class="post__tags">${tagLinksHtml(tags, ctx.home)}</p>`
        : "",
    "source-link": sourceLinkHtml(article),
    discussion: discussionHtml(article.discuss, ctx.lang),
    // Query-string values for the share links
    "share-url": encodeURIComponent(canonicalUrl),
    "share-title": shareText,
    "share-via": via ? `&amp;via=${encodeURIComponent(via)}` : "",
    "canonical-url": escapeHtml(canonicalUrl),
    "related-articles": generateRelatedArticlesHTML(
      relatedArticlesFor(article, articles, originals),
      ctx.lang
    ),
    navigation: generateArticleNavigation(article, articles),
  });
}

// Writes a page of a language into the output directory
function writeOutput(pagePath, lang, html) {
  const file = path.join(OUTPUT_DIR, langPath(pagePath, lang));
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, html);
}

function buildArticle(
  articleFile,
  articleData = null,
  allArticles = null,
  options = {}
) {
  try {
    const article = articleData || getArticleData(articleFile);
    const articles = allArticles || getAllArticles();
    const html = renderArticleHtml(article, articles, options);

    writeOutput(articleFile, article.lang, html);
    return article;
  } catch (error) {
    console.error(`Error building ${articleFile}:`, error.message);
    throw error;
  }
}

function buildIndex(articles, projects = null, options = {}) {
  const html = generateIndexHtml(articles, projects, options);
  writeOutput("index.html", listingLanguage(options.lang, articles), html);
}

function buildArchive(articles, options = {}) {
  const html = generateArchiveHtml(articles, options);
  writeOutput("archive.html", listingLanguage(options.lang, articles), html);
}

function buildTags(articles, options = {}) {
  const tags = collectTags(articles);
  for (const tag of tags) {
    writeOutput(tagUrl(tag), tagLanguage(tag).code, generateTagHtml(tag, options));
  }
  return tags;
}

// `articles` are the pages' language's: a page may not take an article's
// place
function buildPages(pages, articles, options = {}) {
  const articleFiles = new Set(articles.map((article) => article.filename));
  for (const page of pages) {
    if (
      articleFiles.has(page.filename) ||
      RESERVED_PAGES.includes(page.filename)
    ) {
      throw new Error(
        `Page ${langPath(page.filename, page.lang)} would overwrite another page of the site`
      );
    }
    writeOutput(page.filename, page.lang, generatePageHtml(page, options));
  }
}

function buildProjects(projects, options = {}) {
  if (projects.length === 0) return;
  writeOutput(
    "projects.html",
    options.lang,
    generateProjectsHtml(projects, options)
  );
}

// GitHub Pages serves 404.html for any missing path, including nested ones,
// so the template references assets through absolute URLs. It is in the
// default language, with a pointer to each other language's home page.
function generateNotFoundHtml({ translations = null } = {}) {
  const ctx = {
    ...pageContext("", { translations }),
    root: `${BASE_URL}/`,
    home: `${BASE_URL}/`,
  };
  const notes = otherLanguageLinks(ctx)
    .map(
      ({ language, href }) =>
        `<p class="page-head__alt" lang="${language.code}">${language.notFound} <a href="${escapeHtml(href)}">${language.notFoundLink}</a></p>`
    )
    .join("");
  return replaceTemplate(loadTemplate("404"), {
    ...commonReplacements(ctx),
    "other-languages": notes,
  });
}

function buildNotFound(options = {}) {
  const html = generateNotFoundHtml(options);
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

// Every indexable page of one language of the site, for the sitemap and
// IndexNow. `pageDates` holds the last commit days of the files in pages/
// (by their path inside it: "about.html", "cs/about.html") and of the
// projects file.
function sitePages(
  articles,
  { pages = [], projects = [], pageDates = new Map(), lang = null } = {}
) {
  const code = listingLanguage(lang, articles);
  const url = (pagePath) => pageUrl(pagePath, code);
  const articleLastmods = articles.map((article) =>
    day(article.modified || formatDateISO(article.date))
  );
  // Listing pages change exactly when some article does
  const listingLastmod = newestDay(articleLastmods);

  const entries = [
    { url: url(""), lastmod: listingLastmod, changefreq: "daily", priority: 1.0 },
    {
      url: url("archive.html"),
      lastmod: listingLastmod,
      changefreq: "weekly",
      priority: 0.8,
    },
  ];

  if (projects.length > 0) {
    entries.push({
      url: url("projects.html"),
      lastmod: pageDates.get(PROJECTS_FILE),
      changefreq: "monthly",
      priority: 0.8,
    });
  }

  for (const page of pages) {
    entries.push({
      url: url(page.filename),
      lastmod: pageDates.get(langPath(page.filename, code)),
      changefreq: "monthly",
      priority: 0.7,
    });
  }

  for (const tag of collectTags(articles)) {
    entries.push({
      url: url(tagUrl(tag)),
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
      url: url(article.filename),
      lastmod: articleLastmods[index],
      changefreq: "monthly",
      priority: 0.9,
    });
  });

  return entries;
}

function sitemapXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (item) => `  <url>
    <loc>${escapeXml(item.url)}</loc>${
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

function renderSitemap(articles, options = {}) {
  return sitemapXml(sitePages(articles, options));
}

// One sitemap for the whole site: `languages` is the build's content of
// every language ({ lang, articles, pages, projects })
function generateSitemap(languages, pageDates = new Map()) {
  const entries = languages.flatMap(({ lang, articles, pages, projects }) =>
    sitePages(articles, { pages, projects, pageDates, lang })
  );
  fs.writeFileSync(path.join(OUTPUT_DIR, "sitemap.xml"), sitemapXml(entries));
  console.log("✅ Sitemap generated");
}

const RSS_ITEMS = 20;

function cdata(text) {
  return `<![CDATA[${String(text).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

// Full article HTML as a feed reader shows it, with absolute URLs
function feedContent(article, translations = null) {
  const language = articleLanguage(article);
  const url = pageUrl(article.filename, language.code);
  const ctx = pageContext(article.filename, { lang: language.code, translations });
  let html = localizeContentUrls(sanitizeHtml(article.content), ctx);
  if (article.link) {
    html = `<p>${language.link}: <a href="${escapeHtml(article.link)}">${escapeHtml(
      article.link
    )}</a></p>\n${html}`;
  }
  return absolutizeUrls(html, url);
}

// When the feed's content last changed: the newest publication or
// modification of any post, so rebuilding unchanged content leaves the feed
// byte-for-byte the same
function feedUpdated(articles) {
  const times = articles.map((article) =>
    Date.parse(article.modified || formatDateISO(article.date))
  );
  return times.length > 0 ? new Date(Math.max(...times)) : new Date();
}

// The feed of one language: feed.xml, cs/feed.xml ...
function renderRSSFeed(
  articles,
  { lang = null, translations = null } = {}
) {
  const language = getLanguage(listingLanguage(lang, articles));
  const recentArticles = articles.slice(0, RSS_ITEMS);
  const itemUrl = (article) => pageUrl(article.filename, language.code);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(config.site.title)}</title>
    <link>${escapeXml(pageUrl("", language.code))}</link>
    <description>${escapeXml(language.siteDescription)}</description>
    <language>${language.feedLanguage}</language>
    <lastBuildDate>${feedUpdated(articles).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(pageUrl("feed.xml", language.code))}" rel="self" type="application/rss+xml" />
    ${recentArticles
      .map(
        (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(itemUrl(article))}</link>
      <description>${escapeXml(article.description || "")}</description>
      <content:encoded>${cdata(feedContent(article, translations))}</content:encoded>
      <dc:creator>${escapeXml(language.author)}</dc:creator>
      <pubDate>${parseDate(article.date).toUTCString()}</pubDate>
      <guid isPermaLink="true">${escapeXml(itemUrl(article))}</guid>${(
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

function generateRSSFeed(articles, options = {}) {
  writeOutput(
    "feed.xml",
    listingLanguage(options.lang, articles),
    renderRSSFeed(articles, options)
  );
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
// projects page and every tag, plus the language's site-wide card. Cards of
// the other languages are in og/<dir>/ (og-image-<code>.png for the
// site-wide one).
function socialCardSpecs(articles, pages = [], projects = [], lang = null) {
  const language = getLanguage(listingLanguage(lang, articles));
  const card = (key) => `${SOCIAL_CARDS_DIR}/${socialKey(key, language.code)}.png`;
  const specs = [
    {
      file: defaultSocialImage(language.code),
      title: language.defaultCardTitle,
      eyebrow: "",
      image: null,
    },
    ...articles.map((article) => ({
      file: card(article.slug),
      title: article.title,
      eyebrow: isNote(article)
        ? language.note
        : (article.tags || []).map((tag) => tag.label).slice(0, 3).join(" · "),
      image: article.image || null,
    })),
    ...pages.map((page) => ({
      file: card(page.slug),
      title: page.title,
      eyebrow: "",
      image: page.image ? stripLeadingSlash(page.image) : null,
    })),
    ...collectTags(articles).map((tag) => ({
      file: card(`tag-${tag.slug}`),
      title: language.tagTitle(tag.label),
      eyebrow: language.ui.topic,
      image: null,
    })),
  ];
  if (projects.length > 0) {
    const cover = projects.find((project) => project.featured && project.image);
    specs.push({
      file: card("projects"),
      title: language.projectsCardTitle,
      eyebrow: language.projectsTitle,
      image: cover ? cover.image : null,
    });
  }
  // The card's footer names the language's site and author
  return specs.map((spec) => ({ ...spec, lang: language.code }));
}

// Changes when the card's text, image or the card design changes
function socialCardHash(spec, staticDir = STATIC_DIR) {
  const hash = require("crypto").createHash("sha256");
  hash.update(
    JSON.stringify([spec.title, spec.eyebrow, spec.image, spec.lang || null])
  );
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
function getFileDates(dir, paths = ["."]) {
  return new Map(
    [...getGitDates(dir, paths)].map(([file, dates]) => [
      file,
      day(dates.modified),
    ])
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

// ------------------------------------------------------------
// The whole site
// ------------------------------------------------------------

// Where a language's articles or pages are: articles/, articles/cs/ ...
function contentDir(baseDir, lang) {
  const { dir } = getLanguage(lang);
  return dir ? path.join(baseDir, dir) : baseDir;
}

// The content of every language: the default language always, the others
// when they have articles. With `gitDates` (getGitDates), articles published
// on the same day are ordered by their first commit; a translation takes
// its original's place in that order.
function loadSite({ gitDates = null } = {}) {
  const projects = loadProjects();
  return LANGUAGES.map((language) => {
    const articles = getAllArticles(
      contentDir(ARTICLES_DIR, language.code),
      language.code
    );
    if (gitDates) {
      articles.forEach((article) => {
        article.created = (
          gitDates.get(article.filename) ||
          gitDates.get(langPath(article.filename, language.code))
        )?.created;
      });
      articles.sort(compareNewestFirst);
    }
    return {
      lang: language.code,
      articles,
      pages: getAllPages(contentDir(PAGES_DIR, language.code), language.code),
      projects,
    };
  }).filter((entry, index) => index === 0 || entry.articles.length > 0);
}

// Page path ("", "archive.html", "tags/ai.html", "<article>.html" ...) ->
// the languages it exists in, in the order of LANGUAGES
function translationIndex(site) {
  const index = new Map();
  const add = (pagePath, lang) => {
    if (!index.has(pagePath)) index.set(pagePath, []);
    if (!index.get(pagePath).includes(lang)) index.get(pagePath).push(lang);
  };
  for (const { lang, articles, pages, projects } of site) {
    add("", lang);
    add("archive.html", lang);
    if (projects.length > 0) add("projects.html", lang);
    for (const page of pages) add(page.filename, lang);
    for (const tag of collectTags(articles)) add(tagUrl(tag), lang);
    for (const article of articles) add(article.filename, lang);
  }
  return index;
}

// The social cards of every language
function siteSocialCardSpecs(site) {
  return site.flatMap(({ lang, articles, pages, projects }) =>
    socialCardSpecs(articles, pages, projects, lang)
  );
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
    // "created" orders articles published on the same day
    const site = loadSite({ gitDates: getGitDates() });
    const [main] = site;

    if (main.articles.length === 0) {
      console.log("No articles found in articles directory");
      return;
    }

    const translations = translationIndex(site);
    const options = { translations, originals: main.articles };

    // Build every article first so all failures are reported at once
    const failures = [];

    for (const { lang, articles } of site) {
      articles.forEach((article) => {
        const name = langPath(article.filename, lang);
        try {
          buildArticle(article.filename, article, articles, options);
          console.log(`Generated: ${name}`);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        }
      });
    }

    if (failures.length > 0) {
      throw new Error(`Failed to generate articles:\n${failures.join("\n")}`);
    }

    for (const { lang, articles, pages, projects } of site) {
      const languageOptions = { lang, translations };
      const generated = (name) => console.log(`Generated ${langPath(name, lang)}`);

      buildIndex(articles, projects, languageOptions);
      generated("index.html");

      buildArchive(articles, languageOptions);
      generated("archive.html");

      const tags = buildTags(articles, languageOptions);
      console.log(`Generated ${tags.length} tag pages (${lang})`);

      buildProjects(projects, languageOptions);
      if (projects.length > 0) generated("projects.html");

      buildPages(pages, articles, languageOptions);
      pages.forEach((page) => generated(page.filename));

      generateRSSFeed(articles, languageOptions);
      generated("feed.xml");
    }

    buildNotFound({ translations });
    console.log("Generated 404.html");

    // Last commit days of the pages and projects.json, for <lastmod>
    const pageDates = new Map([
      ...(fs.existsSync(PAGES_DIR) ? getFileDates(PAGES_DIR) : []),
      ...getFileDates(path.dirname(PROJECTS_FILE), [
        path.basename(PROJECTS_FILE),
      ]),
    ]);
    generateSitemap(site, pageDates);
    console.log("Generated sitemap.xml");

    const articleCount = site.reduce((sum, { articles }) => sum + articles.length, 0);
    console.log(
      `\nBuild complete: ${articleCount} articles generated (${site
        .map(({ lang, articles }) => `${lang}: ${articles.length}`)
        .join(", ")})`
    );

    const staleCards = staleSocialCards(siteSocialCardSpecs(site));
    if (staleCards.length > 0) {
      console.warn(
        `\n⚠️  ${staleCards.length} social cards are missing or out of date (pages without a card use the default one, outdated cards still show the old title or image). Run: npm run og-images`
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
    loadSite,
    translationIndex,
    contentDir,
    langPath,
    pageUrl,
    localizeTags,
    localizeProject,
    localizeContentUrls,
    typeset,
    siteSocialCardSpecs,
    defaultSocialImage,
    loadProjects,
    collectTags,
    slugify,
    parseTags,
    parseUrlList,
    isAllowedEmbedUrl,
    deriveDescription,
    enhanceImages,
    enhanceCodeBlocks,
    enhanceEmbeds,
    enhanceContent,
    absolutizeUrls,
    discussionLabel,
    pageTitle,
    analyticsHtml,
    subscribeHtml,
    footerProfilesHtml,
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
