#!/usr/bin/env node

const { execFileSync } = require("child_process");
const path = require("path");
const build = require("./build.js");
const { submitToIndexNow } = build;
const config = require("./config.js");

// Changes here affect the markup of every page (a test checks that every
// module build.js loads is listed, except the SEO validator)
const SITE_WIDE_FILES = [
  "build.js",
  "config.js",
  "html-entities.js",
  "image-size.js",
];
const SITE_WIDE_DIRS = [`${config.build.templatesDir}/`];

function articleUrl(baseUrl, file) {
  return `${baseUrl}/${path.basename(file)}`;
}

function listingUrls(baseUrl) {
  return [baseUrl, `${baseUrl}/archive.html`];
}

function tagPageUrl(baseUrl, slug) {
  return `${baseUrl}/tags/${slug}.html`;
}

// Every page of the site. Besides the articles, `site` may list standalone
// pages (pageFiles), whether there is a projects page (hasProjects) and the
// tag slugs of each article (tagsByArticle).
function allSiteUrls({
  baseUrl,
  articleFiles,
  pageFiles = [],
  hasProjects = false,
  tagsByArticle = {},
}) {
  const tagSlugs = [...new Set(Object.values(tagsByArticle).flat())].sort();
  return [
    ...listingUrls(baseUrl),
    ...(hasProjects ? [`${baseUrl}/projects.html`] : []),
    ...pageFiles.map((file) => `${baseUrl}/${path.basename(file)}`),
    ...tagSlugs.map((slug) => tagPageUrl(baseUrl, slug)),
    ...articleFiles.map((file) => articleUrl(baseUrl, file)),
  ];
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
  const changedTagUrls = changedArticles.flatMap((file) => {
    const name = path.basename(file);
    return [
      ...(tagsByArticle[name] || []),
      ...(previousTagsByArticle[name] || []),
    ].map((slug) => tagPageUrl(baseUrl, slug));
  });
  const changedPageUrls = changedFiles
    .filter((file) => file.startsWith(pagePrefix) && file.endsWith(".html"))
    .map((file) => `${baseUrl}/${path.basename(file)}`);
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
  if (changedArticleUrls.length > 0) {
    urls.push(...listingUrls(baseUrl), ...changedArticleUrls, ...changedTagUrls);
  }
  if (projectsChanged) {
    urls.push(baseUrl, `${baseUrl}/projects.html`);
  }
  urls.push(...changedPageUrls);

  return [...new Set(urls)];
}

// What the site consists of now, from the same sources the build uses
function currentSite(baseUrl) {
  const articles = build.getAllArticles();
  return {
    baseUrl,
    articleFiles: articles.map((article) => article.filename),
    pageFiles: build.getAllPages().map((page) => page.filename),
    hasProjects: build.loadProjects().length > 0,
    tagsByArticle: Object.fromEntries(
      articles.map((article) => [
        article.filename,
        article.tags.map((tag) => tag.slug),
      ])
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

// Tag slugs each of `files` (repository paths) had at commit `ref`; files
// that didn't exist then are left out
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
    tags[path.basename(file)] = build
      .parseTags(build.extractMetadata(content).metadata.tags)
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
