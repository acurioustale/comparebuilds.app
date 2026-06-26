import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildFromNamespaceHref, pruneSiblingDirs } from "./blizzardApi.js";

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
