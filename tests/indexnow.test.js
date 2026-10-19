import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import path from "path";

// Mock console methods
const consoleSpy = vi.spyOn(console, "log");

describe("IndexNow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
  });

  it("should skip IndexNow when disabled in development", async () => {
    // Import the function directly (it will use the real config which has enabled: false in dev)
    const { submitToIndexNow } = await import("../build.js");

    const urls = ["https://roblibs-blog.com"];
    await submitToIndexNow(urls);

    // Should log that IndexNow is disabled
    expect(consoleSpy).toHaveBeenCalledWith(
      "IndexNow is disabled (not in production mode)"
    );
  });

  it("should test IndexNow configuration exists", () => {
    const config = require("../config.js");

    expect(config.indexNow).toBeDefined();
    expect(config.indexNow.enabled).toBe(false); // Should be false in development
    expect(config.indexNow.apiKey).toBeDefined();
    expect(Array.isArray(config.indexNow.endpoints)).toBe(true);
    expect(config.indexNow.endpoints.length).toBeGreaterThan(0);
  });

  it("should validate API key format", () => {
    const config = require("../config.js");

    // API key should be a hex string of length 64
    expect(config.indexNow.apiKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should have correct endpoint URLs", () => {
    const config = require("../config.js");

    expect(config.indexNow.endpoints).toContain(
      "https://api.indexnow.org/indexnow"
    );
    expect(config.indexNow.endpoints).toContain(
      "https://www.bing.com/indexnow"
    );
  });
});

describe("IndexNow changed URLs", () => {
  const { urlsForChangedFiles } = require("../index-now.js");
  const site = {
    baseUrl: "https://example.com",
    articleFiles: ["a.html", "b.html"],
  };

  it("should submit changed articles plus listing pages", () => {
    expect(urlsForChangedFiles(["articles/a.html"], site)).toEqual([
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/a.html",
    ]);
  });

  it("should include deleted articles", () => {
    expect(urlsForChangedFiles(["articles/gone.html"], site)).toContain(
      "https://example.com/gone.html"
    );
  });

  it("should submit every page when templates or build change", () => {
    const expected = [
      "https://example.com",
      "https://example.com/archive.html",
      "https://example.com/a.html",
      "https://example.com/b.html",
    ];

    expect(urlsForChangedFiles(["templates/article.html"], site)).toEqual(
      expected
    );
    expect(urlsForChangedFiles(["build.js"], site)).toEqual(expected);
  });

  it("should submit nothing when only static assets or docs change", () => {
    expect(
      urlsForChangedFiles(["static/styles.css", "README.md"], site)
    ).toEqual([]);
  });

  it("should treat every module the build loads as site-wide", () => {
    const fs = require("fs");
    const { SITE_WIDE_FILES } = require("../index-now.js");
    // Only validates output, never changes it
    const outputNeutral = ["seo-validate.js"];

    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const [, name] of source.matchAll(/require\("\.\/([\w-]+)(?:\.js)?"\)/g)) {
        visit(`${name}.js`);
      }
    };
    visit("build.js");

    for (const file of seen) {
      if (!outputNeutral.includes(file)) {
        expect(SITE_WIDE_FILES, file).toContain(file);
      }
    }
  });
});

// Runs index-now.js in production mode in a child process, with fetch
// replaced by canned endpoint responses, so nothing is ever sent
function runIndexNow(args, responses) {
  const script = `
    const calls = [];
    const responses = ${JSON.stringify(responses)};
    globalThis.fetch = async (url, options) => {
      calls.push({ url, hasTimeout: options.signal instanceof AbortSignal });
      const response = responses[calls.length - 1];
      if (response === "network error") throw new Error("fetch failed");
      return { ok: response < 400, status: response };
    };
    process.argv = [process.argv[0], "index-now.js", ...${JSON.stringify(args)}];
    require(${JSON.stringify(path.resolve("index-now.js"))})
      .submitUrls()
      .then(() => console.log("CALLS " + JSON.stringify(calls)));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      BASE_URL: "https://example.com",
    },
  });
  const calls = result.stdout.match(/^CALLS (.*)$/m);
  return { ...result, calls: calls ? JSON.parse(calls[1]) : [] };
}

describe("IndexNow submission results", () => {
  const url = "https://example.com/a.html";

  it("should exit with 1 when every endpoint fails", () => {
    const result = runIndexNow([url], [503, "network error"]);

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(2);
    expect(result.calls.every((call) => call.hasTimeout)).toBe(true);
  });

  it("should succeed when a later endpoint accepts the URLs", () => {
    const result = runIndexNow([url], [503, 202]);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(2);
  });

  it("should stop after the first endpoint that succeeds", () => {
    const result = runIndexNow([url], [200]);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
  });

  it("should reject look-alike hosts in manual mode", () => {
    const result = runIndexNow(["https://example.com.evil.com/a.html"], [200]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("No valid URLs");
    expect(result.calls).toHaveLength(0);
  });
});
