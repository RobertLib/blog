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
// runs this (CI has no Chrome); it only warns when cards are missing or out
// of date. Meanwhile a page without a card uses the default one, and an
// outdated card keeps showing the old title or image.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

// build.js resolves articles/, pages/ and projects.json against the working
// directory. Run from anywhere else it would find no pages at all, and every
// card would look unused and be deleted.
const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const config = require("../config");
const build = require("../build");
const { imageSize } = require("../image-size");

const STATIC_DIR = path.join(ROOT, config.build.staticDir);
const TEMPLATE = path.join(ROOT, build.SOCIAL_CARD_TEMPLATE);
const MANIFEST = path.join(ROOT, build.SOCIAL_CARD_MANIFEST);
const CONCURRENCY = 4;
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

function findChrome() {
  const windows = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .flatMap((dir) => [
      path.join(dir, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]);
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    ...windows,
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Chrome not found. Set CHROME_PATH to a Chrome, Chromium or Edge executable."
    );
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

// Chrome can exit successfully without having written the screenshot, so
// the result is checked before it is used
function screenshot(chrome, htmlFile, outFile, profileDir) {
  return new Promise((resolve, reject) => {
    execFile(
      chrome,
      [
        // Chrome refuses to run as root (containers) with its sandbox on
        ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : []),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        `--window-size=${CARD_WIDTH},${CARD_HEIGHT}`,
        "--virtual-time-budget=3000",
        `--user-data-dir=${profileDir}`,
        `--screenshot=${outFile}`,
        pathToFileURL(htmlFile).href,
      ],
      { timeout: 60000 },
      (error) => {
        if (error) return reject(error);
        const size = fs.existsSync(outFile) ? imageSize(outFile) : null;
        if (!size || size.width !== CARD_WIDTH || size.height !== CARD_HEIGHT) {
          return reject(
            new Error(
              size
                ? `screenshot is ${size.width}x${size.height}, not ${CARD_WIDTH}x${CARD_HEIGHT}`
                : "Chrome wrote no screenshot"
            )
          );
        }
        resolve();
      }
    );
  });
}

// Runs every item even when some fail; resolves to the failures
async function runPool(items, worker) {
  let next = 0;
  const failures = [];
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        try {
          await worker(items[index], index);
        } catch (error) {
          failures.push({ item: items[index], error });
        }
      }
    }
  );
  await Promise.all(runners);
  return failures;
}

async function main() {
  const all = process.argv.includes("--all");
  const articles = build.getAllArticles();
  if (articles.length === 0) {
    throw new Error(
      `No articles found in ${path.resolve(config.build.articlesDir)}; refusing to treat every card as unused.`
    );
  }
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

  let failures = [];
  if (todo.length === 0) {
    console.log("All social cards are up to date.");
  } else {
    const chrome = findChrome();
    const template = fs.readFileSync(TEMPLATE, "utf8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-cards-"));
    fs.mkdirSync(cardsDir, { recursive: true });

    console.log(`Generating ${todo.length} social cards...`);
    try {
      failures = await runPool(todo, async (spec, index) => {
        const htmlFile = path.join(tmp, `card-${index}.html`);
        const pngFile = path.join(tmp, `card-${index}.png`);
        fs.writeFileSync(htmlFile, cardHtml(spec, template));
        await screenshot(
          chrome,
          htmlFile,
          pngFile,
          path.join(tmp, `profile-${index}`)
        );
        // Replaces the old card only once the new one is known to be good
        fs.copyFileSync(pngFile, path.join(STATIC_DIR, spec.file));
        console.log(`  ${spec.file}`);
      });
    } finally {
      // Every Chrome process has exited by now: the pool waits for all
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // A card that failed keeps its old manifest entry, so it stays out of
  // date and is tried again next time
  const failed = new Set(failures.map(({ item }) => item.file));
  const updated = {};
  for (const spec of specs) {
    if (!fs.existsSync(path.join(STATIC_DIR, spec.file))) continue;
    const hash = failed.has(spec.file)
      ? manifest[spec.file]
      : build.socialCardHash(spec, STATIC_DIR);
    if (hash) updated[spec.file] = hash;
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(updated, null, 2)}\n`);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${todo.length} social cards failed:\n` +
        failures
          .map(({ item, error }) => `  ${item.file}: ${error.message}`)
          .join("\n")
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
