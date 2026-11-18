#!/usr/bin/env node

const { execFileSync } = require("child_process");
const build = require("./build.js");
const { submitToIndexNow } = build;
const config = require("./config.js");

const { LANGUAGES, DEFAULT_LANGUAGE } = require("./i18n.js");

// Changes here affect the markup of every page (a test checks that every
// module build.js loads is listed, except the SEO validator)
const SITE_WIDE_FILES = [
  "build.js",
  "config.js",
  "html-entities.js",
  "i18n.js",
  "image-size.js",
];
const SITE_WIDE_DIRS = [`${config.build.templatesDir}/`];

// A content file's language and name, from its path inside articles/ or
// pages/: "x.html" is in the default language, "cs/x.html" in Czech
function splitLanguage(relativeFile) {
  const [first, ...rest] = relativeFile.split("/");
  const language =
    rest.length > 0 && LANGUAGES.find((candidate) => candidate.dir === first);
  return language
    ? { language, name: rest.join("/") }
    : { language: DEFAULT_LANGUAGE, name: relativeFile };
}

// URL of a page of a language; the empty path is its home page
function pageUrlIn(baseUrl, language, pagePath = "") {
  if (!language.dir) return pagePath ? `${baseUrl}/${pagePath}` : baseUrl;
  return `${baseUrl}/${language.dir}/${pagePath}`;
}

// Path inside a content directory: "articles/cs/x.html" -> "cs/x.html"
function relativeTo(dir, file) {
  const prefix = `${dir}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function articleUrl(baseUrl, file) {
  const { language, name } = splitLanguage(
    relativeTo(config.build.articlesDir, file)
  );
  return pageUrlIn(baseUrl, language, name);
}

function pageFileUrl(baseUrl, file) {
  const { language, name } = splitLanguage(
    relativeTo(config.build.pagesDir, file)
  );
  return pageUrlIn(baseUrl, language, name);
}

function listingUrls(baseUrl, language = DEFAULT_LANGUAGE) {
  return [
    pageUrlIn(baseUrl, language),
    pageUrlIn(baseUrl, language, "archive.html"),
  ];
}

function tagPageUrl(baseUrl, slug, language = DEFAULT_LANGUAGE) {
  return pageUrlIn(baseUrl, language, `tags/${slug}.html`);
}

// The tag pages of an article (a path inside articles/), in its language
function articleTagUrls(baseUrl, file, ...tagMaps) {
  const relative = relativeTo(config.build.articlesDir, file);
  const { language } = splitLanguage(relative);
  return tagMaps
    .flatMap((tags) => tags[relative] || [])
    .map((slug) => tagPageUrl(baseUrl, slug, language));
}

// Languages the site has: the default one and every one with articles
function siteLanguages(articleFiles) {
  const codes = new Set(
    articleFiles.map((file) => splitLanguage(file).language.code)
  );
  return LANGUAGES.filter(
    (language) => language === DEFAULT_LANGUAGE || codes.has(language.code)
  );
}

// Every page of the site, language by language. Besides the articles (paths
// inside articles/: "x.html", "cs/x.html"), `site` may list standalone pages
// (pageFiles, paths inside pages/), whether there is a projects page
// (hasProjects) and the tag slugs of each article (tagsByArticle).
function allSiteUrls({
  baseUrl,
  articleFiles,
  pageFiles = [],
  hasProjects = false,
  tagsByArticle = {},
}) {
  const inLanguage = (language) => (file) =>
    splitLanguage(file).language === language;
  return siteLanguages(articleFiles).flatMap((language) => {
    const tagSlugs = [
      ...new Set(
        Object.entries(tagsByArticle)
          .filter(([file]) => inLanguage(language)(file))
          .flatMap(([, slugs]) => slugs)
      ),
    ].sort();
    return [
      ...listingUrls(baseUrl, language),
      ...(hasProjects ? [pageUrlIn(baseUrl, language, "projects.html")] : []),
      ...pageFiles
        .filter(inLanguage(language))
        .map((file) => pageFileUrl(baseUrl, file)),
      ...tagSlugs.map((slug) => tagPageUrl(baseUrl, slug, language)),
      ...articleFiles
        .filter(inLanguage(language))
        .map((file) => articleUrl(baseUrl, file)),
    ];
  });
}

// Maps files changed by a push to the public URLs whose content changed.
// Deleted articles are included as well, so search engines learn about
// removals. Changes to static assets alone don't change any page content.
// `previousTagsByArticle` holds the tags changed articles had before the
// push, so the tag pages a deleted or retagged article left are included.
function urlsForChangedFiles(changedFiles, site) {
  const { baseUrl, tagsByArticle = {}, previousTagsByArticle = {} } = site;
  const articlePrefix = `${config.build.articlesDir}/`;
  const pagePrefix = `${config.build.pagesDir}/`;

  const changedArticles = changedFiles.filter(
    (file) => file.startsWith(articlePrefix) && file.endsWith(".html")
  );
  const changedArticleUrls = changedArticles.map((file) =>
    articleUrl(baseUrl, file)
  );
  // Tag pages list their articles' titles and descriptions
  const changedTagUrls = changedArticles.flatMap((file) =>
    articleTagUrls(baseUrl, file, tagsByArticle, previousTagsByArticle)
  );
  const changedPageUrls = changedFiles
    .filter((file) => file.startsWith(pagePrefix) && file.endsWith(".html"))
    .map((file) => pageFileUrl(baseUrl, file));
  // The projects list shows on the projects page and the home page
  const projectsChanged = changedFiles.includes(config.build.projectsFile);

  const siteWide = changedFiles.some(
    (file) =>
      SITE_WIDE_FILES.includes(file) ||
      SITE_WIDE_DIRS.some((dir) => file.startsWith(dir))
  );

  if (siteWide) {
    return [
      ...new Set([...allSiteUrls(site), ...changedArticleUrls, ...changedTagUrls]),
    ];
  }

  const urls = [];
  // The home page and archive of each language whose articles changed
  const changedLanguages = LANGUAGES.filter((language) =>
    changedArticles.some(
      (file) =>
        splitLanguage(relativeTo(config.build.articlesDir, file)).language ===
        language
    )
  );
  if (changedArticleUrls.length > 0) {
    urls.push(
      ...changedLanguages.flatMap((language) => listingUrls(baseUrl, language)),
      ...changedArticleUrls,
      ...changedTagUrls
    );
  }
  if (projectsChanged) {
    for (const language of siteLanguages(site.articleFiles || [])) {
      urls.push(
        pageUrlIn(baseUrl, language),
        pageUrlIn(baseUrl, language, "projects.html")
      );
    }
  }
  urls.push(...changedPageUrls);

  return [...new Set(urls)];
}

// What the site consists of now, from the same sources the build uses
function currentSite(baseUrl) {
  const site = build.loadSite();
  const inLanguage = (lang, items) =>
    items.map((item) => build.langPath(item.filename, lang));
  return {
    baseUrl,
    articleFiles: site.flatMap(({ lang, articles }) => inLanguage(lang, articles)),
    pageFiles: site.flatMap(({ lang, pages }) => inLanguage(lang, pages)),
    hasProjects: site[0].projects.length > 0,
    tagsByArticle: Object.fromEntries(
      site.flatMap(({ lang, articles }) =>
        articles.map((article) => [
          build.langPath(article.filename, lang),
          article.tags.map((tag) => tag.slug),
        ])
      )
    ),
  };
}

// Returns null when the base commit is unknown (first push, force push),
// in which case every page is treated as changed.
function getChangedFiles(baseRef) {
  if (!baseRef || /^0+$/.test(baseRef)) return null;

  try {
    execFileSync("git", ["cat-file", "-e", `${baseRef}^{commit}`], {
      stdio: "ignore",
    });
  } catch (error) {
    return null;
  }

  return execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-only",
      "--no-renames",
      baseRef,
      "HEAD",
    ],
    { encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);
}

// Tag slugs each of `files` (repository paths in articles/) had at commit
// `ref`, by their path inside articles/; files that didn't exist then are
// left out
function tagsAtCommit(ref, files, cwd = process.cwd()) {
  const tags = {};
  for (const file of files) {
    let content;
    try {
      content = execFileSync("git", ["show", `${ref}:${file}`], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      continue; // Added since ref
    }
    const relative = relativeTo(config.build.articlesDir, file);
    tags[relative] = build
      .localizeTags(
        build.parseTags(build.extractMetadata(content).metadata.tags),
        splitLanguage(relative).language.code
      )
      .map((tag) => tag.slug);
  }
  return tags;
}

function getChangedUrls(baseRef) {
  const site = currentSite(config.site.baseUrl);
  const changedFiles = getChangedFiles(baseRef);

  if (changedFiles === null) {
    console.log(`Base ${baseRef || "(none)"} not available, submitting all URLs`);
    return allSiteUrls(site);
  }

  const articlePrefix = `${config.build.articlesDir}/`;
  site.previousTagsByArticle = tagsAtCommit(
    baseRef,
    changedFiles.filter(
      (file) => file.startsWith(articlePrefix) && file.endsWith(".html")
    )
  );
  return urlsForChangedFiles(changedFiles, site);
}

async function submitUrls() {
  const args = process.argv.slice(2);

  if (args[0] === "--changed-since") {
    const urls = getChangedUrls(args[1]);

    if (urls.length === 0) {
      console.log("No page content changed, nothing to submit to IndexNow");
      return;
    }

    console.log(`Submitting ${urls.length} changed URLs to IndexNow:`);
    urls.forEach((url) => console.log(`  - ${url}`));
    // A failed run is not counted as the base for the next diff, so these
    // pages are submitted again by the next deploy
    if (!(await submitToIndexNow(urls))) process.exitCode = 1;
    return;
  }

  if (args.length === 0) {
    console.log("Usage: node index-now.js <url1> [url2] [url3] ...");
    console.log("       node index-now.js --changed-since <git-ref>");
    console.log(
      "Example: node index-now.js https://roblibs-blog.com/article1.html"
    );
    process.exit(1);
  }

  // Validate URLs
  const siteHost = new URL(config.site.baseUrl).host;
  const validUrls = [];
  for (const url of args) {
    try {
      if (new URL(url).host === siteHost) {
        validUrls.push(url);
      } else {
        console.warn(`⚠️  Skipping URL (not from this domain): ${url}`);
      }
    } catch (error) {
      console.warn(`⚠️  Invalid URL: ${url}`);
    }
  }

  if (validUrls.length === 0) {
    console.log("❌ No valid URLs to submit");
    process.exit(1);
  }

  console.log(`Submitting ${validUrls.length} URLs to IndexNow:`);
  validUrls.forEach((url) => console.log(`  - ${url}`));

  if (!(await submitToIndexNow(validUrls))) process.exitCode = 1;
}

if (require.main === module) {
  submitUrls().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}

module.exports = {
  submitUrls,
  urlsForChangedFiles,
  allSiteUrls,
  currentSite,
  getChangedUrls,
  tagsAtCommit,
  SITE_WIDE_FILES,
};
