#!/usr/bin/env node

// SEO Validation Script
const fs = require("fs");
const path = require("path");
const { decodeEntities } = require("./html-entities");

const DIST_DIR = "dist";
const MIN_TITLE_LENGTH = 50;
const MAX_TITLE_LENGTH = 60;
const MIN_DESCRIPTION_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 160;

// Length is measured on the text a search engine displays, so entities are
// decoded and whitespace from multi-line markup is collapsed.
function toDisplayText(html) {
  return decodeEntities(html).replace(/\s+/g, " ").trim();
}

function validateSEO(distDir = DIST_DIR) {
  console.log("🔍 SEO Validation Report\n");

  if (!fs.existsSync(distDir)) {
    console.log(`❌ Distribution directory '${distDir}' does not exist`);
    return false;
  }

  const htmlFiles = fs
    .readdirSync(distDir)
    .filter((file) => file.endsWith(".html"))
    .filter((file) => file !== "404.html") // Not indexed (noindex)
    .filter((file) => !file.startsWith("google")); // Skip Google verification files

  let hasErrors = false;

  htmlFiles.forEach((file) => {
    const filePath = path.join(distDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    console.log(`📄 ${file}`);

    // Check title length
    const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleMatch) {
      console.log(`  ❌ Missing <title>`);
      hasErrors = true;
    } else {
      const title = toDisplayText(titleMatch[1]);
      const titleLength = title.length;

      if (titleLength < MIN_TITLE_LENGTH) {
        console.log(
          `  ❌ Title too short: ${titleLength} chars (min ${MIN_TITLE_LENGTH})`
        );
        console.log(`     "${title}"`);
        hasErrors = true;
      } else if (titleLength > MAX_TITLE_LENGTH) {
        console.log(
          `  ❌ Title too long: ${titleLength} chars (max ${MAX_TITLE_LENGTH})`
        );
        console.log(`     "${title}"`);
        hasErrors = true;
      } else {
        console.log(`  ✅ Title length: ${titleLength} chars`);
      }
    }

    // Check meta description length
    const descMatch = content.match(
      /<meta\s+name="description"\s+content="([^"]*)"/
    );
    if (!descMatch) {
      console.log(`  ❌ Missing meta description`);
      hasErrors = true;
    } else {
      const description = toDisplayText(descMatch[1]);
      const descLength = description.length;

      if (descLength < MIN_DESCRIPTION_LENGTH) {
        console.log(
          `  ❌ Description too short: ${descLength} chars (min ${MIN_DESCRIPTION_LENGTH})`
        );
        console.log(`     "${description}"`);
        hasErrors = true;
      } else if (descLength > MAX_DESCRIPTION_LENGTH) {
        console.log(
          `  ❌ Description too long: ${descLength} chars (max ${MAX_DESCRIPTION_LENGTH})`
        );
        console.log(`     "${description}"`);
        hasErrors = true;
      } else {
        console.log(`  ✅ Description length: ${descLength} chars`);
      }
    }

    // Check og:image
    const ogImageMatch = content.match(
      /<meta\s+property="og:image"\s+content="(.*?)"/
    );
    if (ogImageMatch) {
      console.log(`  ✅ OG Image: ${ogImageMatch[1]}`);
    } else {
      console.log(`  ❌ Missing og:image`);
      hasErrors = true;
    }

    // Check og:title
    const ogTitleMatch = content.match(
      /<meta\s+property="og:title"\s+content="(.*?)"/
    );
    if (ogTitleMatch) {
      console.log(`  ✅ OG Title present`);
    } else {
      console.log(`  ❌ Missing og:title`);
      hasErrors = true;
    }

    // Check og:description
    const ogDescMatch = content.match(
      /<meta\s+property="og:description"\s+content="(.*?)"/
    );
    if (ogDescMatch) {
      console.log(`  ✅ OG Description present`);
    } else {
      console.log(`  ❌ Missing og:description`);
      hasErrors = true;
    }

    console.log("");
  });

  if (hasErrors) {
    console.log("❌ SEO validation failed - please fix the issues above");
    return false;
  } else {
    console.log("✅ All SEO checks passed!");
    return true;
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateSEO };
}

// Run validation if this script is executed directly
if (require.main === module) {
  const success = validateSEO();
  process.exit(success ? 0 : 1);
}
