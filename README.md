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
- 🧪 Complete test coverage

## 📁 Project Structure

```
blog/
├── articles/          # HTML articles with metadata
├── templates/         # HTML templates (index, archive, article)
├── static/           # Static files (CSS, favicon, etc.)
├── tests/            # Unit and integration tests
├── dist/             # Generated static website
├── build.js          # Main build script
├── config.js         # Project configuration
└── package.json      # NPM configuration
```

## 🚀 Quick Start

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

## 🛠️ Available Commands

```bash
# Development
npm run dev          # Build + serve on http://localhost:3000

# Build
npm run build        # Development build
npm run build:prod   # Production build for GitHub Pages

# Testing
npm test            # Run all tests

# IndexNow
npm run indexnow <url>  # Submit specific URL to IndexNow

# Other
npm start           # Serve dist folder
npm run clean       # Clean dist folder
```

## 🏗️ Build Process

1. **Load templates** from `templates/` directory
2. **Parse articles** from `articles/` with metadata extraction
3. **Generate pages**:
   - `index.html` - Homepage with recent articles
   - `archive.html` - Archive of all articles
   - `articles/[name].html` - Individual articles
4. **Copy static files** from `static/`

## ⚙️ Configuration

Edit `config.js` to customize:

```javascript
module.exports = {
  site: {
    title: "RobLib's Blog",
    description: "Blog about programming and web technologies",
    author: "Robert Libšanský",
    baseUrl: "https://roblibs-blog.com",
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

**Automatic submission during build:**

- Production builds (`npm run build:prod`) automatically submit all URLs
- Includes homepage, archive page, and all articles
- Only active in production environment

**Manual submission:**

```bash
npm run indexnow https://roblibs-blog.com/new-article.html
npm run indexnow https://roblibs-blog.com/article1.html https://roblibs-blog.com/article2.html
```

### Benefits

- **Faster indexing**: Search engines learn about new/changed pages immediately
- **Reduced load**: Search engines don't need to crawl as frequently
- **Better SEO**: New content appears in search results faster

### API Key

The API key is automatically generated and stored as a static file that must be accessible on your domain for verification.

## 🧪 Testing

The project includes complete test coverage:

- `build.test.js` - Build process testing
- `config.test.js` - Configuration testing
- `html-generation.test.js` - HTML generation testing
- `file-operations.test.js` - File operations testing
- `integration.test.js` - Integration tests
- `edge-cases.test.js` - Edge cases and error handling
- `utils.test.js` - Utility functions
- `indexnow.test.js` - IndexNow integration testing

## 📄 License

MIT License - see [LICENSE](LICENSE) file.
