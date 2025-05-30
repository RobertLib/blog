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
    apiKey: "f57799dcfb29699bee2683154c12d7fb6f1842a04cf57bcf75fe3153eaeb1fb7",
    endpoints: [
      "https://api.indexnow.org/indexnow",
      "https://www.bing.com/indexnow",
    ],
  },
};
