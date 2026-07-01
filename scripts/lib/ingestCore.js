/**
 * scripts/lib/ingestCore.js
 * -------------------------
 * Source-agnostic ingest pipeline shared by every `scripts/ingest<Source>.js`.
 *
 * An ingest script's only job is to fetch its upstream and map it to the
 * normalised schema (the objects in src/data/{slug}.json). Everything that
 * happens to that normalised data afterwards — validating it, writing the files,
 * and regenerating the wire-layout snapshot — is identical regardless of source,
 * and lives here so the sources can't drift on it.
 *
 * The snapshot is the cross-source oracle (see src/lib/wireLayout.js): build
 * strings stay interchangeable across sources only because every source uses
 * Blizzard's own node IDs, and the snapshot fingerprints exactly that. A source
 * that owns the snapshot regenerates it (`updateSnapshot: true`); a source being
 * cross-validated instead compares against it (`verifyAgainstSnapshot`) and must
 * NOT overwrite it, or the check would be meaningless.
 *
 * Node-only (fs + node:crypto via wireLayout); never imported by the browser app.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateClassData } from "../../src/lib/validateClassData.js";
import { wireLayout } from "../../src/lib/wireLayout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const OUT_DIR = join(__dirname, "..", "..", "src", "data");
export const SNAPSHOT_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "wireLayout.snapshot.json",
);

// Base talent point budgets for the Midnight expansion (from the levelling
// system). Levels 10-70 alternate class/spec → 31 class + 30 spec. Levels 71+
// cycle across all three trees; class reaches 34, spec base 30, last hero point
// at 89. These are properties of the game's progression, not of any one data
// source — the per-spec spec/hero totals are overridden by each source's
// normaliser (spec adds apex ranks; hero counts non-alreadyGranted nodes).
export const POINT_BUDGET = { class: 34, spec: 30, hero: 0 };

export function writeJson(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2), "utf8");
}

/**
 * Validates every class against the schema + its index entry.
 * Pure: no I/O, no writes. Used by both the write path and the comparison tool.
 *
 * @param {object[]} classIndex            The classes.json index array
 * @param {Record<string, object>} classes slug → normalised class data
 * @returns {{ totalProblems: number, byClass: Record<string, string[]> }}
 */
export function validateClasses(classIndex, classes) {
  const byClass = {};
  let totalProblems = 0;
  for (const [slug, data] of Object.entries(classes)) {
    const indexEntry = classIndex.find((c) => c.id === data.classId);
    const problems = validateClassData(data, indexEntry);
    byClass[slug] = problems;
    totalProblems += problems.length;
  }
  return { totalProblems, byClass };
}

/**
 * Computes each class's wire-layout fingerprint and compares it to the committed
 * snapshot — the proof that a source is build-string-compatible. Read-only; never
 * writes the snapshot.
 *
 * @param {Record<string, object>} classes slug → normalised class data
 * @returns {{ allMatch: boolean, results: Array<{ slug, match, expected, got }> }}
 */
export function verifyAgainstSnapshot(classes) {
  const saved = existsSync(SNAPSHOT_PATH)
    ? JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"))
    : {};
  const results = [];
  let allMatch = true;
  for (const [slug, data] of Object.entries(classes)) {
    const got = wireLayout(data);
    const expected = saved[slug] ?? null;
    const match =
      expected != null &&
      expected.count === got.count &&
      expected.hash === got.hash;
    if (!match) allMatch = false;
    results.push({ slug, match, expected, got });
  }
  return { allMatch, results };
}

/**
 * Validates and writes the full normalised dataset to src/data/, and (only for a
 * source that owns the snapshot, and only when validation is clean) regenerates
 * the wire-layout snapshot.
 *
 * On any validation failure the committed src/data/ and the snapshot are left
 * UNTOUCHED — broken output must never overwrite the last-good data, or a stray
 * `git commit` after an ignored non-zero exit would ship it. The rejected output
 * is written to an `.invalid/` inspection subdir (outside the app's
 * `../data/*.json` glob) so it can still be diffed.
 *
 * Does not exit the process — returns the outcome so the caller decides. Logs a
 * concise per-class line to stdout/stderr.
 *
 * @param {object}   args
 * @param {object[]} args.classIndex          classes.json index array
 * @param {Record<string, object>} args.classes slug → normalised class data
 * @param {boolean}  [args.updateSnapshot]     regenerate the snapshot when clean
 * @param {string}   [args.outDir]             override output dir (e.g. a scratch
 *                                             dir for a verify-only run)
 * @param {string}   [args.snapshotPath]       override snapshot path (tests)
 * @returns {{ validationFailures: number, snapshotUpdated: boolean }}
 */
export function writeNormalizedData({
  classIndex,
  classes,
  updateSnapshot = false,
  outDir = OUT_DIR,
  snapshotPath = SNAPSHOT_PATH,
}) {
  const { totalProblems, byClass } = validateClasses(classIndex, classes);

  if (totalProblems > 0) {
    // Don't clobber committed data: write the rejected attempt to an inspection
    // subdir and leave src/data/ and the snapshot exactly as they were.
    const inspectDir = join(outDir, ".invalid");
    mkdirSync(inspectDir, { recursive: true });
    writeJson(inspectDir, "classes.json", classIndex);
    for (const [slug, data] of Object.entries(classes)) {
      const problems = byClass[slug];
      if (problems.length > 0) {
        console.error(`✗ ${slug}: validation failed (${problems.length})`);
        for (const p of problems) console.error(`      - ${p}`);
      }
      writeJson(inspectDir, `${slug}.json`, data);
    }
    console.error(
      `\n✗ ${totalProblems} validation problem(s) — committed src/data/ and the ` +
        `wire-layout snapshot were left untouched. Rejected output written to ` +
        `${inspectDir} for inspection. Fix the source/normaliser and re-run.`,
    );
    return { validationFailures: totalProblems, snapshotUpdated: false };
  }

  mkdirSync(outDir, { recursive: true });
  writeJson(outDir, "classes.json", classIndex);
  console.log(`  → ${join(outDir, "classes.json")}`);
  for (const [slug, data] of Object.entries(classes)) {
    writeJson(outDir, `${slug}.json`, data);
    console.log(`  → ${join(outDir, `${slug}.json`)}`);
  }

  let snapshotUpdated = false;
  if (updateSnapshot) {
    // Merge into the existing snapshot rather than replacing it wholesale.
    // `classes` may be a filtered subset (e.g. `--class=hunter`), but the
    // snapshot is the whole-class oracle every share link is checked against —
    // overwriting it from a partial set would silently drop every other class's
    // fingerprint, destroying their build-string compatibility proof. Regenerate
    // only the classes actually promoted here and keep the rest intact.
    const snapshot = existsSync(snapshotPath)
      ? JSON.parse(readFileSync(snapshotPath, "utf8"))
      : {};
    for (const [slug, data] of Object.entries(classes)) {
      snapshot[slug] = wireLayout(data);
    }
    writeFileSync(
      snapshotPath,
      JSON.stringify(snapshot, null, 2) + "\n",
      "utf8",
    );
    console.log(`  → ${snapshotPath}`);
    snapshotUpdated = true;
  }

  return { validationFailures: 0, snapshotUpdated };
}
