/**
 * Data-integrity tests.
 *
 * Run:  npm test   (or: npx vitest run src/lib/dataIntegrity.test.js)
 *
 * Two layers of protection for the normalised data in src/data/:
 *
 *   1. Schema validation — every implemented class validates against
 *      validateClassData(), cross-checked against the classes.json index.
 *      Catches malformed hand edits and structurally different sources.
 *
 *   2. Wire-layout snapshot — the build-string bit layout per class is
 *      fingerprinted and compared to a committed snapshot. Catches data changes
 *      that would silently shift bit positions and break existing build strings.
 *      Regenerate intentionally with:  UPDATE_SNAPSHOTS=1 npm test
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateClassData } from "./validateClassData.js";
import { wireLayout } from "./wireLayout.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "wireLayout.snapshot.json");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const classIndex = require("../data/classes.json");
const implemented = classIndex.filter((c) => c.implemented);

// ── 1. Schema validation ──────────────────────────────────────────────────────

for (const cls of implemented) {
  test(`${cls.displayName} validates against the schema + index`, () => {
    const data = require(`../data/${cls.name}.json`);
    const errors = validateClassData(data, cls);
    assert.strictEqual(
      errors.length,
      0,
      `${errors.length} problem(s):\n` +
        errors.map((e) => `         - ${e}`).join("\n"),
    );
  });
}

test("every implemented class in the index has a data file", () => {
  for (const cls of implemented) {
    assert.ok(
      existsSync(join(__dirname, "..", "data", `${cls.name}.json`)),
      `missing src/data/${cls.name}.json`,
    );
  }
});

// ── 1b. Gate-checkpoint consistency ───────────────────────────────────────────
//
// A section's visual gate dividers (spec.checkpoints) and its per-node gate
// thresholds (node.spentRequired) are produced separately at ingest, so they can
// silently drift — and a drift would make a node "look locked" at a row it doesn't
// actually gate at, or hide a real gate. The two legitimately differ per node (a
// node may sit visually in a gated row yet unlock earlier — e.g. Discipline
// Priest's "Divine Procession" at row 7 needs only 8 points), so this asserts the
// weaker structural agreement that must always hold:
//   - checkpoint rows and points both strictly increase (a real gate ladder);
//   - every checkpoint reflects a real node — some node at that exact posY carries
//     that spentRequired (no phantom divider);
//   - every distinct non-zero spentRequired in the section is shown as a checkpoint
//     (no gate tier missing from the legend).
for (const cls of implemented) {
  test(`${cls.displayName} gate checkpoints agree with node thresholds`, () => {
    const data = require(`../data/${cls.name}.json`);
    for (const [slug, spec] of Object.entries(data.specs)) {
      for (const section of ["class", "spec"]) {
        const cps = spec.checkpoints?.[section] ?? [];
        const nodes = spec.nodes.filter((n) => n.treeType === section);
        const where = `${slug}/${section}`;

        for (let i = 1; i < cps.length; i++) {
          assert.ok(
            cps[i].row > cps[i - 1].row && cps[i].points > cps[i - 1].points,
            `${where}: checkpoints must ascend by row and points: ${JSON.stringify(cps)}`,
          );
        }

        for (const c of cps) {
          assert.ok(
            nodes.some((n) => n.posY === c.row && n.spentRequired === c.points),
            `${where}: checkpoint ${JSON.stringify(c)} has no node at posY ${c.row} requiring ${c.points} points`,
          );
        }

        const cpPoints = new Set(cps.map((c) => c.points));
        for (const req of new Set(
          nodes.map((n) => n.spentRequired).filter((r) => r > 0),
        )) {
          assert.ok(
            cpPoints.has(req),
            `${where}: nodes require ${req} points but no checkpoint shows that gate`,
          );
        }
      }
    }
  });
}

// ── 2. Wire-layout snapshot ───────────────────────────────────────────────────

const current = {};
for (const cls of implemented) {
  current[cls.name] = wireLayout(require(`../data/${cls.name}.json`));
}

if (UPDATE || !existsSync(SNAPSHOT_PATH)) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + "\n", "utf8");
  console.log(
    `  ⟳  ${UPDATE ? "updated" : "created"} ${SNAPSHOT_PATH.replace(/.*\/src\//, "src/")}`,
  );
} else {
  const saved = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));

  for (const cls of implemented) {
    test(`${cls.displayName} wire layout is unchanged`, () => {
      const exp = saved[cls.name];
      const got = current[cls.name];
      assert.ok(
        exp,
        `no snapshot for "${cls.name}" — run UPDATE_SNAPSHOTS=1 if this class is new`,
      );
      assert.deepStrictEqual(
        got,
        exp,
        `wire layout changed (count ${exp.count}→${got.count}). ` +
          `If this was an intentional data update, regenerate with ` +
          `UPDATE_SNAPSHOTS=1 npm test — but note every existing build string for ` +
          `${cls.displayName} will now parse differently.`,
      );
    });
  }

  test("snapshot has no stale classes", () => {
    for (const name of Object.keys(saved)) {
      assert.ok(
        current[name],
        `snapshot has "${name}" but no implemented class matches`,
      );
    }
  });
}
