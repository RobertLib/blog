import { describe, it, expect, vi, beforeEach } from "vitest";

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
