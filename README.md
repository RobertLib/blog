# RobLib's Blog

A simple static blog generator that creates a blog from HTML articles with metadata. The blog is available at [roblibs-blog.com](https://roblibs-blog.com).

## ✨ Features

- 📝 Static blog generation from HTML articles
- 🏷️ Metadata in HTML comments
- 📄 Automatic archive page generation
- 🎨 Responsive design with modern CSS
- 🔍 SEO optimized pages
- 📊 Recent articles management
- 🚀 IndexNow integration for faster search engine indexing
- 🧪 Unit tests plus an end-to-end production build test

## 📁 Project Structure

```
blog/
├── articles/          # HTML articles with metadata
├── templates/         # HTML templates (index, archive, article, 404)
│   └── partials/      # Shared head assets, header and footer
├── static/           # Static files (CSS, JS, fonts, favicon, OG image)
├── tools/            # Sources for generated assets (OG image)
├── tests/            # Unit and integration tests
├── dist/             # Generated static website
├── build.js          # Main build script
├── seo-validate.js   # SEO checks run at the end of every build
├── html-entities.js  # HTML entity decoding shared by the scripts above
├── index-now.js      # IndexNow submission (manual or from CI)
├── config.js         # Project configuration
└── package.json      # NPM configuration
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
- **Social card** — `static/og-image.png` is generated from
  `tools/og-image.html`; the regeneration command is in the comment at the top
  of that file.

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

- `title` - Article title (required)
- `date` - Publication date in YYYY-MM-DD format (required)
- `description` - Short description for SEO and previews (required)

An article with missing or invalid metadata fails the build, so it can never
silently disappear from the site. The SEO check also requires page titles of
50–60 characters (including the " - RobLib's Blog" suffix) and descriptions of
150–160 characters.

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
   - `index.html` - Homepage with recent articles
   - `archive.html` - Archive of all articles
   - `[name].html` - Individual articles
   - `404.html` - Not-found page served by GitHub Pages
   - `sitemap.xml` and `feed.xml`
4. **Validate SEO** of every generated page

Templates share markup through partials: a line holding only
`{{> header}}` is replaced by `templates/partials/header.html`. Partial
placeholders are filled like the page's own; `{{root}}` prefixes asset and
page links (empty, i.e. relative, except on the 404 page, which GitHub Pages
also serves for nested paths and therefore uses absolute URLs).

## 🔄 Deployment

The GitHub Actions workflow in `.github/workflows/deploy.yml`:

- runs tests and a production build for every push and pull request to `main`
  (with full git history, which the modification dates need)
- deploys to GitHub Pages only on pushes to `main`
- after a successful deploy, submits the changed pages to IndexNow

## ⚙️ Configuration

Edit `config.js` to customize:

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
    outputDir: "dist",
    templatesDir: "templates",
    staticDir: "static",
    recentArticlesCount: 10,
  },
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
  - changed, added or deleted articles, plus the homepage and archive
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
- `indexnow.test.js` - IndexNow configuration and changed-URL selection
- `contrast.test.js` - WCAG AA contrast of the text colors in both themes

## 📄 License

MIT License - see [LICENSE](LICENSE) file.
