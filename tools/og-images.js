#!/usr/bin/env node

// Generates the social cards (og:image) of every page into static/: one per
// article, standalone page, tag and the projects page, plus the default card.
// Each card is tools/og-card.html filled in and screenshotted with headless
// Chrome. Only cards whose title, image or template changed are regenerated
// (tools/og-cards.json remembers what each was made from); --all redoes all.
//
//   npm run og-images
//   npm run og-images -- --all
//
// Set CHROME_PATH when Chrome is not in a standard location. The build never
// runs this (CI has no Chrome); it only warns when cards are out of date, and
// those pages fall back to the default card meanwhile.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const config = require("../config");
const build = require("../build");

const ROOT = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT, config.build.staticDir);
const TEMPLATE = path.join(ROOT, build.SOCIAL_CARD_TEMPLATE);
const MANIFEST = path.join(ROOT, build.SOCIAL_CARD_MANIFEST);
const CONCURRENCY = 4;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Chrome not found. Set CHROME_PATH to its executable.");
  }
  return found;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardHtml(spec, template) {
  const image = spec.image
    ? pathToFileURL(path.join(STATIC_DIR, spec.image)).href
    : "";
  const values = {
    title: escapeHtml(spec.title),
    eyebrow: escapeHtml(spec.eyebrow || ""),
    "image-url": image,
    "body-class": image ? "has-image" : "no-image",
    "font-url": pathToFileURL(
      path.join(STATIC_DIR, "fonts", "inter-latin.woff2")
    ).href,
  };
  return template.replace(/\{\{([\w-]+)\}\}/g, (match, key) =>
    key in values ? values[key] : match
  );
}

function screenshot(chrome, htmlFile, outFile, profileDir) {
  return new Promise((resolve, reject) => {
    execFile(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        "--window-size=1200,630",
        "--virtual-time-budget=3000",
        `--user-data-dir=${profileDir}`,
        `--screenshot=${outFile}`,
        pathToFileURL(htmlFile).href,
      ],
      { timeout: 60000 },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

async function runPool(items, worker) {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
      }
    }
  );
  await Promise.all(runners);
}

async function main() {
  const all = process.argv.includes("--all");
  const articles = build.getAllArticles();
  const pages = build.getAllPages();
  const projects = build.loadProjects();
  const specs = build.socialCardSpecs(articles, pages, projects);

  const manifest = build.readSocialCardManifest(MANIFEST);
  const todo = all ? specs : build.staleSocialCards(specs, STATIC_DIR, manifest);

  // Cards of pages that no longer exist (renamed articles, removed tags)
  const cardsDir = path.join(STATIC_DIR, build.SOCIAL_CARDS_DIR);
  const wanted = new Set(specs.map((spec) => spec.file));
  if (fs.existsSync(cardsDir)) {
    for (const file of fs.readdirSync(cardsDir)) {
      const relative = `${build.SOCIAL_CARDS_DIR}/${file}`;
      if (file.endsWith(".png") && !wanted.has(relative)) {
        fs.rmSync(path.join(cardsDir, file));
        console.log(`Removed unused card ${relative}`);
      }
    }
  }

  if (todo.length === 0) {
    console.log("All social cards are up to date.");
  } else {
    const chrome = findChrome();
    const template = fs.readFileSync(TEMPLATE, "utf8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-cards-"));
    fs.mkdirSync(cardsDir, { recursive: true });

    console.log(`Generating ${todo.length} social cards...`);
    try {
      await runPool(todo, async (spec, index) => {
        const htmlFile = path.join(tmp, `card-${index}.html`);
        fs.writeFileSync(htmlFile, cardHtml(spec, template));
        await screenshot(
          chrome,
          htmlFile,
          path.join(STATIC_DIR, spec.file),
          path.join(tmp, `profile-${index}`)
        );
        console.log(`  ${spec.file}`);
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const updated = {};
  for (const spec of specs) {
    if (fs.existsSync(path.join(STATIC_DIR, spec.file))) {
      updated[spec.file] = build.socialCardHash(spec, STATIC_DIR);
    }
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(updated, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
