import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  BlizzardApi,
  buildFromNamespaceHref,
  pruneSiblingDirs,
} from "./blizzardApi.js";

describe("buildFromNamespaceHref", () => {
  it("extracts the wago build from a version-pinned namespace href", () => {
    const href =
      "https://us.api.blizzard.com/data/wow/talent-tree/?namespace=static-12.0.7_67808-us";
    expect(buildFromNamespaceHref(href, "us")).toBe("12.0.7.67808");
  });

  it("respects the region", () => {
    const href = "x?namespace=static-12.0.7_67808-eu";
    expect(buildFromNamespaceHref(href, "eu")).toBe("12.0.7.67808");
    expect(buildFromNamespaceHref(href, "us")).toBeNull(); // region mismatch
  });

  it("returns null for a missing or shapeless href", () => {
    expect(buildFromNamespaceHref(undefined, "us")).toBeNull();
    expect(buildFromNamespaceHref("no namespace here", "us")).toBeNull();
  });
});

describe("pruneSiblingDirs", () => {
  it("removes every entry except the one to keep", () => {
    const root = mkdtempSync(join(tmpdir(), "prune-"));
    try {
      for (const b of ["12.0.7.1", "12.0.7.2", "12.0.7.3"])
        mkdirSync(join(root, b));
      pruneSiblingDirs(root, "12.0.7.3");
      expect(readdirSync(root)).toEqual(["12.0.7.3"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is a no-op when the parent doesn't exist", () => {
    expect(() =>
      pruneSiblingDirs(join(tmpdir(), "does-not-exist-xyz"), "x"),
    ).not.toThrow();
  });
});

describe("BlizzardApi token refresh on 401", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };
  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  // Classify a request by exact host (not a substring match) so the mock can't
  // be fooled by a host like oauth.battle.net.example.com.
  const isOauth = (url) => new URL(url).hostname === "oauth.battle.net";

  beforeEach(() => {
    process.env.BLIZZARD_CLIENT_ID = "id";
    process.env.BLIZZARD_CLIENT_SECRET = "secret";
    delete process.env.BLIZZARD_CREDENTIALS_FILE;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("re-authenticates and retries once on a 401", async () => {
    let oauthCalls = 0;
    let dataCalls = 0;
    global.fetch = vi.fn(async (url) => {
      if (isOauth(url)) {
        oauthCalls++;
        return jsonRes(200, { access_token: `t${oauthCalls}` });
      }
      dataCalls++;
      return dataCalls === 1
        ? jsonRes(401, {})
        : jsonRes(200, { n: dataCalls });
    });

    const api = new BlizzardApi({ cache: false });
    const out = await api._fetchJson("https://us.api.blizzard.com/data/wow/x");
    expect(out).toEqual({ n: 2 });
    expect(oauthCalls).toBe(2); // token re-fetched after the 401
    expect(dataCalls).toBe(2); // data request retried exactly once
  });

  it("throws and does not loop on a persistent 401", async () => {
    let dataCalls = 0;
    global.fetch = vi.fn(async (url) => {
      if (isOauth(url)) return jsonRes(200, { access_token: "t" });
      dataCalls++;
      return jsonRes(401, {});
    });

    const api = new BlizzardApi({ cache: false });
    await expect(
      api._fetchJson("https://us.api.blizzard.com/data/wow/x"),
    ).rejects.toThrow(/HTTP 401/);
    expect(dataCalls).toBe(2); // retried once then gave up
  });
});
