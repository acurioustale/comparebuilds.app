/**
 * Tests for the shared ingest pipeline's write path. Focus: a validation failure
 * must never clobber the committed src/data/, only an .invalid/ inspection copy.
 */

import { describe, test, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { writeNormalizedData } from "./ingestCore.js";

const require = createRequire(import.meta.url);
const classIndex = require("../../src/data/classes.json");
const validData = require("../../src/data/death_knight.json");

let outDir;
beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "ingestcore-"));
});
afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("writeNormalizedData", () => {
  test("writes the committed dataset when validation is clean", () => {
    const res = writeNormalizedData({
      classIndex,
      classes: { death_knight: validData },
      outDir,
    });
    assert.strictEqual(res.validationFailures, 0);
    assert.ok(existsSync(join(outDir, "death_knight.json")));
    assert.ok(existsSync(join(outDir, "classes.json")));
    assert.ok(!existsSync(join(outDir, ".invalid")));
  });

  test("merges into the existing snapshot instead of overwriting it", () => {
    // Pre-seed a snapshot holding two OTHER classes' fingerprints, then promote
    // only death_knight with updateSnapshot. The promoted class must be written
    // AND the pre-existing classes must survive — a filtered promote must never
    // drop other classes' oracle entries.
    const snapshotPath = join(outDir, "snapshot.json");
    const seeded = {
      warrior: { count: 111, hash: "warrior-hash" },
      mage: { count: 222, hash: "mage-hash" },
    };
    writeFileSync(snapshotPath, JSON.stringify(seeded, null, 2) + "\n", "utf8");

    const res = writeNormalizedData({
      classIndex,
      classes: { death_knight: validData },
      updateSnapshot: true,
      outDir,
      snapshotPath,
    });

    assert.strictEqual(res.validationFailures, 0);
    assert.strictEqual(res.snapshotUpdated, true);
    const merged = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assert.deepStrictEqual(
      merged.warrior,
      seeded.warrior,
      "pre-existing warrior fingerprint preserved",
    );
    assert.deepStrictEqual(
      merged.mage,
      seeded.mage,
      "pre-existing mage fingerprint preserved",
    );
    assert.ok(
      merged.death_knight && typeof merged.death_knight.hash === "string",
      "promoted class fingerprint written",
    );
  });

  test("leaves committed data untouched and routes invalid output to .invalid/", () => {
    const broken = structuredClone(validData);
    broken.specs.blood.nodes[0].type = "bogus"; // not in {round,square,choice,apex}

    const res = writeNormalizedData({
      classIndex,
      classes: { death_knight: broken },
      outDir,
    });

    assert.ok(res.validationFailures > 0, "reports validation failures");
    assert.strictEqual(res.snapshotUpdated, false);
    // Committed dataset must NOT be written.
    assert.ok(
      !existsSync(join(outDir, "death_knight.json")),
      "committed class file not clobbered",
    );
    // Rejected output goes to the inspection subdir instead.
    const invalidFile = join(outDir, ".invalid", "death_knight.json");
    assert.ok(existsSync(invalidFile), "inspection copy written");
    assert.strictEqual(
      JSON.parse(readFileSync(invalidFile, "utf8")).specs.blood.nodes[0].type,
      "bogus",
    );
  });
});
