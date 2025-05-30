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
};
