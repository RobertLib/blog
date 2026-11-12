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

Articles are HTML files with metadata in comments at the top of the file
(comments further down are ordinary HTML comments, never metadata):

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
- `date` - Publication date in YYYY-MM-DD format (required; other formats
  fail the build). It can't be in the future: a static site has no scheduled
  publishing, so the build fails rather than publish a post under a date that
  hasn't happened yet
- `updated` - The day of the last substantial update, YYYY-MM-DD (optional).
  Set it when you rewrite part of an article or add an update note, not for
  fixing typos or small errors. It is shown under the title ("Updated ...")
  and becomes the sitemap `<lastmod>` and JSON-LD `dateModified`; without it
  both are the publication date
- `description` - Short description for SEO and previews (required for
  articles, optional for notes)
- `tags` - Comma-separated topics, e.g. `Games, C, WebAssembly`. Each tag
  gets a page at `tags/<slug>.html` (`C++` becomes `cpp`, `C#` `csharp`);
  reuse existing tags (see the Topics on the archive page) rather than
  inventing near-duplicates, since spellings with the same slug (`Next.js`,
  `NextJS`) are one tag. The first tag is also the article's section
  (`article:section`); untagged articles have none
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
site. So does an article named like a page the build generates itself
(`index.html`, `archive.html`, `projects.html`, `404.html`).

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
     only when clicked. The poster links to the game's page, which is what
     readers without JavaScript and feed readers get -->
<figure
  class="embed"
  data-embed="https://itch.io/embed-upload/20080149?color=000000"
  data-embed-ratio="800 / 582"
  data-embed-title="Chuck"
  data-embed-touch-note="Needs a keyboard or gamepad"
>
  <div class="embed__stage">
    <a href="https://roblib.itch.io/chuck"><img src="images/chuck/sector-09.png" alt="..." /></a>
  </div>
  <figcaption>Click the picture to play.</figcaption>
</figure>
```

Local images get their `width`/`height` from the file and lazy loading
(except the first one) at build time. Embeds and `<iframe>`s are only kept
for hosts in `config.embeds.allowedHosts` (others are removed with a build
warning). `data-embed-ratio` is the game's width / height (in itch.io's embed
code, the height includes its 30 px bottom bar); the build gives the stage that
shape up front and fails on a malformed ratio. The optional
`data-embed-touch-note` is shown on the play button on phones and tablets
without a mouse or trackpad: say there what a game needs that a touch screen
lacks, or that it is a big download. Prefer WebP for screenshots
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

The generator renders `tools/og-card.html` with headless Chrome, Chromium
or Edge (set `CHROME_PATH` if none is found) into `static/og/<slug>.png` and
`static/og-image.png`, and records what each card was made from in
`tools/og-cards.json`. The build never runs it (CI has no Chrome): it warns
about missing or outdated cards. Until the cards are regenerated and
committed, a page without a card uses the default one, and an outdated card
keeps showing the old title or image. Run it after adding an article or
changing a title, tags or cover image. It works from any directory, checks
every screenshot before replacing a card, and a card that fails keeps its
old image and is retried on the next run.

Dates are calendar days and render the same in any time zone. An article's
modification date is its `updated` day or, without one, its publication date;
it never comes from git, so a round of fixes across old articles doesn't
present all of them as freshly updated. Git history (author dates, so a
rebase changes nothing) only adds:

- the order of articles published on the same day: by their first commit,
  with a not yet committed article counting as the newest
- the sitemap `<lastmod>` of standalone pages and the projects page: the last
  commit that changed `pages/<name>.html` or `projects.json` beyond its
  metadata comments

Without git history (or in a shallow clone) same-day articles are ordered by
file name and those pages have no `<lastmod>`.

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
profiles, X handle and photo used in structured data; profiles with
`footer: true` are also linked in the footer):

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
    article's tag pages, including tags it had before the change (so a
    deleted or retagged article's old tag pages are resubmitted too)
  - changed pages from `pages/`; the homepage and projects page when
    `projects.json` changes
  - every page when `templates/`, `build.js`, `config.js`,
    `html-entities.js` or `image-size.js` changed
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

The key is set in `config.indexNow.apiKey`, and search engines verify it by
fetching `https://<your-domain>/<key>.txt`, so the same key must be in a file
of that name in `static/` (here
`static/f57799dcfb29699bee2683154c12d7fb6f1842a04cf57bcf75fe3153eaeb1fb7.txt`,
containing just the key). To use a new key, generate any 8–128 character
hexadecimal string and change both.

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
- `contrast.test.js` - WCAG AA contrast of the text colors in both themes,
  including accent text on the translucent accent wash and on hovered rows,
  and text on accent buttons (also when hovered)
- `styles.test.js` - Guards against stylesheet rules lost in editing (a
  selector list running across a comment, unstyled meta separators, lede)

## 📄 License

MIT License - see [LICENSE](LICENSE) file.
