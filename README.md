# Blog Generator

A simple static blog generator that creates a blog from HTML articles with metadata.

## Usage

1. Add articles to the `articles/` directory
2. Run `npm run build` to generate the site
3. Run `npm start` to serve the site locally

## Article Format

Articles should be HTML files with metadata in comments:

```html
<!-- title: Article Title -->
<!-- date: YYYY-MM-DD -->
<!-- description: Article description -->

<p>Article content...</p>
```

## Build

```bash
npm run build
```

## Serve

```bash
npm start
```
