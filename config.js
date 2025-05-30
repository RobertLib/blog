module.exports = {
  site: {
    title: "RobLib's Blog",
    description: "Blog about programming and web technologies",
    author: "Robert Libšanský",
    baseUrl:
      process.env.NODE_ENV === "production"
        ? process.env.BASE_URL || "https://robertlib.github.io/blog"
        : "http://localhost:3000",
  },
  build: {
    articlesDir: "articles",
    outputDir: "dist",
    templatesDir: "templates",
    staticDir: "static",
    recentArticlesCount: 10,
  },
};
