#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { submitToIndexNow } = require("./build.js");
const config = require("./config.js");

// Changes here affect the markup of every page (a test checks that every
// module build.js loads is listed, except the SEO validator)
const SITE_WIDE_FILES = ["build.js", "config.js", "html-entities.js"];
const SITE_WIDE_DIRS = [`${config.build.templatesDir}/`];

function getArticleFiles(articlesDir = config.build.articlesDir) {
  if (!fs.existsSync(articlesDir)) return [];
  return fs.readdirSync(articlesDir).filter((file) => file.endsWith(".html"));
}

function articleUrl(baseUrl, file) {
  return `${baseUrl}/${path.basename(file)}`;
}

function listingUrls(baseUrl) {
  return [baseUrl, `${baseUrl}/archive.html`];
}

function allSiteUrls({ baseUrl, articleFiles }) {
  return [
    ...listingUrls(baseUrl),
    ...articleFiles.map((file) => articleUrl(baseUrl, file)),
  ];
}

// Maps files changed by a push to the public URLs whose content changed.
// Deleted articles are included as well, so search engines learn about
// removals. Changes to static assets alone don't change any page content.
function urlsForChangedFiles(changedFiles, { baseUrl, articleFiles }) {
  const articlePrefix = `${config.build.articlesDir}/`;

  const changedArticleUrls = changedFiles
    .filter((file) => file.startsWith(articlePrefix) && file.endsWith(".html"))
    .map((file) => articleUrl(baseUrl, file));

  const siteWide = changedFiles.some(
    (file) =>
      SITE_WIDE_FILES.includes(file) ||
      SITE_WIDE_DIRS.some((dir) => file.startsWith(dir))
  );

  if (siteWide) {
    return [
      ...new Set([
        ...allSiteUrls({ baseUrl, articleFiles }),
        ...changedArticleUrls,
      ]),
    ];
  }

  if (changedArticleUrls.length === 0) return [];

  return [...new Set([...listingUrls(baseUrl), ...changedArticleUrls])];
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

function getChangedUrls(baseRef) {
  const articleFiles = getArticleFiles();
  const baseUrl = config.site.baseUrl;
  const changedFiles = getChangedFiles(baseRef);

  if (changedFiles === null) {
    console.log(`Base ${baseRef || "(none)"} not available, submitting all URLs`);
    return allSiteUrls({ baseUrl, articleFiles });
  }

  return urlsForChangedFiles(changedFiles, { baseUrl, articleFiles });
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
  getChangedUrls,
  SITE_WIDE_FILES,
};
