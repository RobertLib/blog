# RobLib's Blog

A simple static blog generator that creates a blog from HTML articles with metadata. The blog is available at [roblibs-blog.com](https://roblibs-blog.com).

## ✨ Features

- 📝 Static blog generation from HTML articles, plus short notes and link posts
- 🏷️ Metadata in HTML comments, with tags and a page per tag
- 🖼️ Images sized at build time, click-to-play game and video embeds
- 🃏 A generated social card (og:image) for every page
- 🎮 Projects page and home page showcase from `projects.json`
- 👤 Standalone pages (About) from `pages/`
- 📰 Full-content RSS feed, sitemap with every page type
- 📈 Optional GoatCounter analytics and Buttondown newsletter sign-up
- 🔍 SEO checks on every build, structured data (JSON-LD) on every page
- 🚀 IndexNow integration for faster search engine indexing
- 🧪 Unit tests plus an end-to-end production build test

## 📁 Project Structure

```
blog/
├── articles/          # HTML articles and notes with metadata
├── pages/             # Standalone pages (about.html)
├── projects.json      # Projects page and home page showcase
├── templates/         # HTML templates (index, archive, article, tag,
│   │                  # page, projects, 404)
│   └── partials/      # Shared head meta, head assets, header and footer
├── static/            # Static files (CSS, JS, fonts, favicon, images)
│   ├── images/        # Images used in articles and projects
│   └── og/            # Generated social cards (npm run og-images)
├── tools/             # Social card template and generator
├── tests/             # Unit and integration tests
├── dist/              # Generated static website
├── build.js           # Main build script
├── image-size.js      # Image dimensions from file headers
├── seo-validate.js    # SEO checks run at the end of every build
├── html-entities.js   # HTML entity decoding shared by the scripts above
├── index-now.js       # IndexNow submission (manual or from CI)
├── config.js          # Project configuration
└── package.json       # NPM configuration
```

## 🎨 Design

- **Typography** — Inter for interface and headings, Source Serif 4 for body
  copy, the system monospace stack for code and micro labels. Both webfonts are
  self-hosted as variable `woff2` subsets in `static/fonts/` (latin +
  latin-ext), preloaded, so there are no third-party requests.
- **Theme** — follows the OS colour scheme by default; the header toggle stores
  an explicit choice in `localStorage` and a tiny inline script applies it
  before first paint to avoid a flash.
- **Stylesheet** — `static/styles.css`, driven by custom properties declared
  once per theme at the top of the file.
- **Social cards** — every article, page, tag and the projects page gets its
  own 1200×630 card with its title (and its cover image, if it has one),
  generated from `tools/og-card.html` by `npm run og-images`. See
  [Social cards](#-social-cards).

## 🚀 Quick Start

Requires Node.js 22.12 or newer (CI runs on Node.js 24).

1. **Clone the repository**

   ```bash
   git clone https://github.com/robertlib/blog.git
   cd blog
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start development**
   ```bash
   npm run dev
   ```

## 📝 Article Format

Articles are HTML files with metadata in comments:

```html
<!-- title: Article Title -->
<!-- date: YYYY-MM-DD -->
<!-- description: Article description for SEO -->

<p>Article content in HTML...</p>

<h2>Subheading</h2>
<p>More content...</p>
```

### Metadata

- `title` - Article title (required). Write it as a claim or a specific
  promise, not a category: "I Knew CSS Too Well to See Why Tailwind Works"
  rather than "When Experience Becomes an Obstacle"
- `date` - Publication date in YYYY-MM-DD format (required)
- `description` - Short description for SEO and previews (required for
  articles, optional for notes)
- `tags` - Comma-separated topics, e.g. `Games, C, WebAssembly`. Each tag
  gets a page at `tags/<slug>.html`; reuse existing tags (see the Topics on
  the archive page) rather than inventing near-duplicates
- `image` - Cover image, a path inside `static/`
  (`images/chuck/sector-09.png`). Used in the structured data and as the
  picture on the article's social card
- `type` - `article` (default) or `note`, a short post without reading
  time or lede; its description is taken from its opening text
- `link` - For notes about another page: its URL, shown under the title
- `discuss` - URLs of discussions about the post (Hacker News, Lobsters,
  Reddit, ...), shown as "Discuss" links under the article. Add them after
  submitting the post

An article with missing or invalid metadata, or pointing at an image that
doesn't exist, fails the build, so it can never silently disappear from the
site.

The SEO check fails on titles over 70 characters (cut off in search results)
and descriptions under 50 or over 200, and warns outside 60 and 110–160. The
" - RobLib's Blog" suffix is left out of the `<title>` when it would push it
past 60 characters.

### Images and embeds

```html
<figure>
  <img src="images/chuck/facade.png" alt="Chuck climbing the facade" />
  <figcaption>One of the outdoor climbs.</figcaption>
</figure>

<!-- Three phone screenshots side by side -->
<figure class="gallery">
  <img src="images/jetshot/wave.webp" alt="..." />
  <img src="images/jetshot/boss.webp" alt="..." />
  <img src="images/jetshot/overdrive.webp" alt="..." />
  <figcaption>Jetshot on iPhone.</figcaption>
</figure>

<!-- Click-to-play: shows the image with a play button, loads the game
     only when clicked -->
<figure
  class="embed"
  data-embed="https://itch.io/embed-upload/1321096?color=000000"
  data-embed-ratio="800 / 582"
  data-embed-title="Chuck"
>
  <div class="embed__stage"><img src="images/chuck/sector-09.png" alt="..." /></div>
  <figcaption>Play Chuck right here.</figcaption>
</figure>
```

Local images get their `width`/`height` from the file and lazy loading
(except the first one) at build time. Embeds and `<iframe>`s are only kept
for hosts in `config.embeds.allowedHosts`. Prefer WebP for screenshots
(`cwebp -q 82 -resize 1200 0 in.png -o out.webp`).

## 📄 Pages and projects

- `pages/*.html` become top-level pages with the same metadata comments
  (`title`, `description`, optional `lede`, `image`, `nav` to highlight a
  header link, `schema: profile` for an about page).
- `projects.json` lists projects for `projects.html`, grouped by
  `category` (`games`, `apps`, `web`). Projects with `featured: true`
  appear on the home page. Fields: `name`, `summary`, `url`,
  `linkLabel`, optional `platforms`, `source`, `article` (an article
  file name) and `image` (a path inside `static/`).

## 🃏 Social cards

```bash
npm run og-images          # generate missing or outdated cards
npm run og-images -- --all # regenerate every card
```

The generator renders `tools/og-card.html` with headless Chrome (set
`CHROME_PATH` if it isn't found) into `static/og/<slug>.png` and
`static/og-image.png`, and records what each card was made from in
`tools/og-cards.json`. The build never runs it (CI has no Chrome): it warns
about missing or outdated cards, and those pages use the default card until
the cards are regenerated and committed. Run it after adding an article or
changing a title, tags or cover image.

Dates are calendar days and render the same in any time zone. Git history
adds what a day can't express (author dates, so a rebase changes nothing):

- articles published on the same day are ordered by their first commit, and
  a not yet committed article counts as the newest
- the modification date (sitemap `<lastmod>`, JSON-LD `dateModified`) is the
  article's last commit, never earlier than its publication date

Without git history (or in a shallow clone) only the publication date is used.

## 🛠️ Available Commands

```bash
# Development
npm run dev          # Build + serve on http://localhost:3000

# Build
npm run build        # Development build
npm run build:prod   # Production build for GitHub Pages

# Testing
npm test             # Run all tests
npm run seo-validate # Re-run the SEO checks on an existing dist/

# Social cards (needs Chrome)
npm run og-images    # Generate missing or outdated social cards

# IndexNow (submits to the production site; exits with 1 if submission fails)
npm run indexnow <url>                     # Submit specific URLs
npm run indexnow -- --changed-since <ref>  # Submit pages changed since a git ref

# Other
npm start           # Serve dist folder (serve, installed as a dev dependency)
npm run clean       # Clean dist folder
```

## 🏗️ Build Process

1. **Copy static files** from `static/` to `dist/`
2. **Parse and validate articles** from `articles/` (any invalid article fails
   the build)
3. **Generate pages** into `dist/`:
   - `index.html` - Homepage with featured projects and recent articles
   - `archive.html` - Archive by topic and year
   - `[name].html` - Individual articles and notes
   - `tags/[tag].html` - One page per tag
   - `projects.html` - Projects from `projects.json`
   - `[page].html` - Standalone pages from `pages/`
   - `404.html` - Not-found page served by GitHub Pages
   - `sitemap.xml` and `feed.xml` (the 20 newest posts, full content)
4. **Validate SEO** of every generated page

Templates share markup through partials: a line holding only
`{{> header}}` is replaced by `templates/partials/header.html`. Partial
placeholders are filled like the page's own; `{{root}}` prefixes asset and
page links (empty, i.e. relative; `../` on tag pages; absolute on the 404
page, which GitHub Pages also serves for nested paths). Structured data is
built in `build.js` and inserted as `{{json-ld}}`.

## 🔄 Deployment

The GitHub Actions workflow in `.github/workflows/deploy.yml`:

- runs tests and a production build for every push and pull request to `main`
  (with full git history, which the modification dates need)
- deploys to GitHub Pages only on pushes to `main`
- after a successful deploy, submits the changed pages to IndexNow

## 📈 Analytics and newsletter

Both are off until configured in `config.js`:

- **Analytics** — create a free site at [goatcounter.com](https://www.goatcounter.com)
  (no cookies, no consent banner needed) and set `analytics.goatcounter` to
  its code. The script is added to production builds only.
- **Newsletter** — create a [Buttondown](https://buttondown.com) account and
  set `newsletter.buttondown` to the username. Every article and listing page
  then shows an email sign-up form instead of the RSS call to action.

## ⚙️ Configuration

Edit `config.js` to customize (abridged; `site` also holds the author's
profiles, X handle and photo used in structured data):

```javascript
module.exports = {
  site: {
    title: "RobLib's Blog",
    description: "Blog about programming and web technologies",
    author: "Robert Libsansky",
    baseUrl:
      process.env.NODE_ENV === "production"
        ? process.env.BASE_URL || "https://roblibs-blog.com"
        : "http://localhost:3000",
  },
  build: {
    articlesDir: "articles",
    pagesDir: "pages",
    outputDir: "dist",
    templatesDir: "templates",
    staticDir: "static",
    projectsFile: "projects.json",
    recentArticlesCount: 10,
  },
  embeds: { allowedHosts: ["itch.io", "www.youtube-nocookie.com", /* ... */] },
  analytics: { goatcounter: "" }, // GoatCounter site code, production only
  newsletter: { buttondown: "" }, // Buttondown username for the sign-up form
  indexNow: {
    enabled: process.env.NODE_ENV === "production",
    apiKey: "your-api-key-here",
    endpoints: [
      "https://api.indexnow.org/indexnow",
      "https://www.bing.com/indexnow",
    ],
  },
};
```

## 🚀 IndexNow Integration

This blog includes [IndexNow](https://www.indexnow.org/) integration for faster search engine indexing.

### What is IndexNow?

IndexNow is an open protocol that allows websites to instantly inform search engines about content changes. Supported by:

- Microsoft Bing
- Seznam.cz
- Yandex
- Other search engines

### How it works

**Automatic submission after deploy:**

- The build itself never contacts IndexNow; the `indexnow` job in the deploy
  workflow runs only after the new version is live
- It submits only pages whose content changed since the last workflow run that
  completed every job (`node index-now.js --changed-since <that commit>`), so
  changes from a push whose run was cancelled or failed are not lost:
  - changed, added or deleted articles, plus the homepage, archive and the
    article's tag pages
  - changed pages from `pages/`; the homepage and projects page when
    `projects.json` changes
  - every page when `templates/`, `build.js`, `config.js` or
    `html-entities.js` changed
  - nothing when only static assets or docs changed
- If every IndexNow endpoint fails (or times out after 15 s), the job fails,
  so the next run submits the same pages again
- If there is no such run, or its commit is unknown (e.g. after a force push),
  all pages are submitted

**Manual submission:**

```bash
npm run indexnow https://roblibs-blog.com/new-article.html
npm run indexnow https://roblibs-blog.com/article1.html https://roblibs-blog.com/article2.html
npm run indexnow -- --changed-since HEAD~1
```

### Benefits

- **Faster indexing**: Search engines learn about new/changed pages immediately
- **Reduced load**: Search engines don't need to crawl as frequently
- **Better SEO**: New content appears in search results faster

### API Key

The API key is automatically generated and stored as a static file that must be accessible on your domain for verification.

## 🧪 Testing

Tests run with [Vitest](https://vitest.dev/) (`npm test`) and in CI before
every build:

- `build.test.js` - Article parsing, validation, templating, sanitization
- `config.test.js` - Configuration
- `html-generation.test.js` - Rendered pages, sitemap, RSS and dates, checked
  on the real templates
- `file-operations.test.js` - Template and article loading
- `integration.test.js` - Full production build of a temporary copy of the
  project (every page generated, SEO checks pass, invalid articles fail)
- `edge-cases.test.js`, `utils.test.js` - Edge cases of the helpers
- `seo-validate.test.js` - SEO validator
- `features.test.js` - Tags, notes, images and embeds, projects and pages,
  analytics and newsletter, social cards, IndexNow URLs for every page type
- `indexnow.test.js` - IndexNow configuration and changed-URL selection
- `contrast.test.js` - WCAG AA contrast of the text colors in both themes

## 📄 License

MIT License - see [LICENSE](LICENSE) file.
