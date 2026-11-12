#!/usr/bin/env node

// SEO Validation Script
//
// Errors fail the build; warnings only point at things worth a look.
// Titles and descriptions are not forced into a narrow length window: search
// engines don't rank a 40-character title lower than a 55-character one, and
// forcing every headline to the same length makes them generic. Only lengths
// that get cut off or are clearly broken are errors.
const fs = require("fs");
const path = require("path");
const { decodeEntities } = require("./html-entities");

const DIST_DIR = "dist";

const TITLE_MIN = 10; // error below: an accidental or placeholder title
const TITLE_MAX = 70; // error above: cut off in search results
const TITLE_DISPLAYED = 60; // warning above: may be cut off

const DESCRIPTION_MIN = 50; // error below: too thin to be useful
const DESCRIPTION_MAX = 200; // error above: mostly cut off
const DESCRIPTION_SHORT = 110; // warning below: room for more context
const DESCRIPTION_DISPLAYED = 160; // warning above: may be cut off

// Length is measured on the text a search engine displays, so entities are
// decoded and whitespace from multi-line markup is collapsed.
function toDisplayText(html) {
  return decodeEntities(html).replace(/\s+/g, " ").trim();
}

// Every HTML page below distDir, as paths relative to it
function listHtmlFiles(distDir, dir = "") {
  return fs
    .readdirSync(path.join(distDir, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return listHtmlFiles(distDir, relative);
      return entry.name.endsWith(".html") ? [relative] : [];
    })
    .sort();
}

function metaContent(content, attribute, name) {
  const match = content.match(
    new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="([^"]*)"`)
  );
  return match ? match[1] : null;
}

function checkLength(label, text, { min, max, warnBelow, warnAbove }) {
  const length = text.length;
  if (length < min) {
    return { level: "error", message: `${label} too short: ${length} chars (min ${min})` };
  }
  if (length > max) {
    return { level: "error", message: `${label} too long: ${length} chars (max ${max})` };
  }
  if (warnBelow && length < warnBelow) {
    return {
      level: "warning",
      message: `${label} is short: ${length} chars (${warnBelow}+ gives search results more context)`,
    };
  }
  if (warnAbove && length > warnAbove) {
    return {
      level: "warning",
      message: `${label} may be cut off in search results: ${length} chars`,
    };
  }
  return { level: "ok", message: `${label} length: ${length} chars` };
}

function validatePage(content, distDir) {
  const results = [];
  const error = (message) => results.push({ level: "error", message });

  const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
  if (!titleMatch) {
    error("Missing <title>");
  } else {
    const title = toDisplayText(titleMatch[1]);
    results.push({
      ...checkLength("Title", title, {
        min: TITLE_MIN,
        max: TITLE_MAX,
        warnAbove: TITLE_DISPLAYED,
      }),
      detail: title,
    });
  }

  const description = metaContent(content, "name", "description");
  if (description === null) {
    error("Missing meta description");
  } else {
    const text = toDisplayText(description);
    results.push({
      ...checkLength("Description", text, {
        min: DESCRIPTION_MIN,
        max: DESCRIPTION_MAX,
        warnBelow: DESCRIPTION_SHORT,
        warnAbove: DESCRIPTION_DISPLAYED,
      }),
      detail: text,
    });
  }

  const h1Count = (content.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) error(`Expected one <h1>, found ${h1Count}`);

  for (const property of ["og:title", "og:description"]) {
    if (metaContent(content, "property", property) === null) {
      error(`Missing ${property}`);
    }
  }

  const ogImage = metaContent(content, "property", "og:image");
  if (ogImage === null) {
    error("Missing og:image");
  } else {
    // An image on this site must have been generated into the output
    let localPath = null;
    try {
      const url = new URL(decodeEntities(ogImage));
      const canonical = content.match(
        /<link\s+rel="canonical"\s+href="([^"]*)"/
      );
      const site = canonical
        ? new URL(decodeEntities(canonical[1])).origin
        : null;
      if (url.origin === site) localPath = decodeURIComponent(url.pathname);
    } catch (e) {
      error(`og:image is not an absolute URL: ${ogImage}`);
    }
    if (localPath && !fs.existsSync(path.join(distDir, localPath))) {
      error(`og:image file not found: ${localPath}`);
    } else {
      results.push({ level: "ok", message: `OG Image: ${ogImage}` });
    }
  }

  return results;
}

function validateSEO(distDir = DIST_DIR) {
  console.log("🔍 SEO Validation Report\n");

  if (!fs.existsSync(distDir)) {
    console.log(`❌ Distribution directory '${distDir}' does not exist`);
    return false;
  }

  const htmlFiles = listHtmlFiles(distDir)
    .filter((file) => file !== "404.html") // Not indexed (noindex)
    .filter((file) => !path.basename(file).startsWith("google")); // Verification files

  let errors = 0;
  let warnings = 0;
  const icons = { ok: "✅", warning: "⚠️ ", error: "❌" };

  htmlFiles.forEach((file) => {
    const content = fs.readFileSync(path.join(distDir, file), "utf8");
    const results = validatePage(content, distDir);

    console.log(`📄 ${file}`);
    for (const result of results) {
      console.log(`  ${icons[result.level]} ${result.message}`);
      if (result.level !== "ok" && result.detail) {
        console.log(`     "${result.detail}"`);
      }
      if (result.level === "error") errors++;
      if (result.level === "warning") warnings++;
    }
    console.log("");
  });

  if (errors > 0) {
    console.log(
      `❌ SEO validation failed with ${errors} errors - please fix the issues above`
    );
    return false;
  }
  console.log(
    warnings > 0
      ? `✅ All SEO checks passed (${warnings} warnings)`
      : "✅ All SEO checks passed!"
  );
  return true;
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateSEO, validatePage, listHtmlFiles };
}

// Run validation if this script is executed directly
if (require.main === module) {
  const success = validateSEO();
  process.exit(success ? 0 : 1);
}
