module.exports = {
  site: {
    title: "RobLib's Blog",
    description:
      "Notes on building small, self-contained software: games that fit in kilobytes, offline iPhone apps, pragmatic web development and honest notes on AI.",
    author: "Robert Libsansky",
    // Shown in social cards and the author's structured data
    authorJobTitle: "Full-Stack Developer",
    authorImage: "images/robert-libsansky.jpg",
    twitter: "@RobertLibsansky",
    // The author's other profiles (schema.org sameAs); `footer: true` also
    // links them in the footer of every page
    profiles: [
      { name: "roblib.dev", url: "https://roblib.dev/" },
      { name: "X", url: "https://x.com/RobertLibsansky", footer: true },
      { name: "GitHub", url: "https://github.com/RobertLib", footer: true },
      { name: "itch.io", url: "https://roblib.itch.io/", footer: true },
      {
        name: "App Store",
        url: "https://apps.apple.com/us/developer/robert-libsansky/id1634043416",
      },
    ],
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
  // Hosts whose pages articles may embed in an <iframe> or a click-to-play
  // [data-embed] block (games, videos). Anything else fails the build.
  embeds: {
    allowedHosts: [
      "itch.io",
      "www.youtube-nocookie.com",
      "www.youtube.com",
      "player.vimeo.com",
    ],
  },
  // Privacy-friendly page view counting, included in production builds only.
  // Set the code of a https://www.goatcounter.com site ("roblib" for
  // roblib.goatcounter.com); empty disables analytics.
  analytics: {
    goatcounter: "",
  },
  // Email subscriptions through https://buttondown.com. Set the Buttondown
  // username to show a sign-up form; empty shows an RSS call to action.
  newsletter: {
    buttondown: "",
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
