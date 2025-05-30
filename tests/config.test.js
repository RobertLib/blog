import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Config", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[require.resolve("../config.js")];
  });

  it("should use development configuration by default", () => {
    process.env.NODE_ENV = "development";
    delete process.env.BASE_URL;

    const config = require("../config.js");

    expect(config.site.title).toBe("RobLib's Blog");
    expect(config.site.description).toBe(
      "Blog about programming and web technologies"
    );
    expect(config.site.author).toBe("Robert Libsansky");
    expect(config.site.baseUrl).toBe("http://localhost:3000");
  });

  it("should use production configuration when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.BASE_URL;

    const config = require("../config.js");

    expect(config.site.baseUrl).toBe("https://roblibs-blog.com");
  });

  it("should use custom BASE_URL when provided in production", () => {
    process.env.NODE_ENV = "production";
    process.env.BASE_URL = "https://custom-domain.com";

    const config = require("../config.js");

    expect(config.site.baseUrl).toBe("https://custom-domain.com");
  });

  it("should have correct build configuration", () => {
    const config = require("../config.js");

    expect(config.build.articlesDir).toBe("articles");
    expect(config.build.outputDir).toBe("dist");
    expect(config.build.templatesDir).toBe("templates");
    expect(config.build.staticDir).toBe("static");
    expect(config.build.recentArticlesCount).toBe(10);
  });

  it("should handle missing NODE_ENV", () => {
    delete process.env.NODE_ENV;
    delete process.env.BASE_URL;

    const config = require("../config.js");

    expect(config.site.baseUrl).toBe("http://localhost:3000");
  });

  it("should have all required site properties", () => {
    const config = require("../config.js");

    expect(config.site).toHaveProperty("title");
    expect(config.site).toHaveProperty("description");
    expect(config.site).toHaveProperty("author");
    expect(config.site).toHaveProperty("baseUrl");

    expect(typeof config.site.title).toBe("string");
    expect(typeof config.site.description).toBe("string");
    expect(typeof config.site.author).toBe("string");
    expect(typeof config.site.baseUrl).toBe("string");
  });

  it("should have all required build properties", () => {
    const config = require("../config.js");

    expect(config.build).toHaveProperty("articlesDir");
    expect(config.build).toHaveProperty("outputDir");
    expect(config.build).toHaveProperty("templatesDir");
    expect(config.build).toHaveProperty("staticDir");
    expect(config.build).toHaveProperty("recentArticlesCount");

    expect(typeof config.build.articlesDir).toBe("string");
    expect(typeof config.build.outputDir).toBe("string");
    expect(typeof config.build.templatesDir).toBe("string");
    expect(typeof config.build.staticDir).toBe("string");
    expect(typeof config.build.recentArticlesCount).toBe("number");
  });
});
