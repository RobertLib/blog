#!/usr/bin/env node

const { submitToIndexNow } = require("./build.js");
const config = require("./config.js");

async function submitUrls() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node index-now.js <url1> [url2] [url3] ...");
    console.log(
      "Example: node index-now.js https://roblibs-blog.com/article1.html"
    );
    process.exit(1);
  }

  // Validate URLs
  const validUrls = [];
  for (const url of args) {
    try {
      new URL(url);
      if (url.startsWith(config.site.baseUrl)) {
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

  await submitToIndexNow(validUrls);
}

if (require.main === module) {
  submitUrls().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}

module.exports = { submitUrls };
