import { activeHeroSubtree } from "./treeLogic.js";

/**
 * Builds the default human-readable label for a build slot, e.g.
 * "Build 1 — San'layn Blood Death Knight". Shared by the build-manager slot
 * labels and the SimulationCraft profileset names so the two can't drift.
 *
 * The hero-spec prefix is derived from the parsed build's active hero subtree
 * when the tree data and parse are available; otherwise it is omitted. When the
 * class/spec display names are absent the label collapses to "Build N".
 *
 * When exactly two builds are loaded (`total === 2`), the numeric ordinal is
 * swapped for "A"/"B" — this signals "these two are being diffed" the way the
 * comparison view's own red/blue A vs B convention already does. `total` is
 * opt-in so callers that don't care about that distinction (e.g. SimC
 * profileset naming) are unaffected.
 *
 * Pure / no-DOM so it lives in src/lib.
 *
 * @param {object} args
 * @param {number} args.index 1-based build number shown in the label
 * @param {number} [args.total] Total number of loaded builds
 * @param {string} [args.className] Display name of the class
 * @param {string} [args.specName] Display name of the spec
 * @param {object} [args.treeData] Spec tree data definition (needs `.nodes`)
 * @param {object} [args.parsedBuild] Parsed build object (needs `.nodes`)
 * @returns {string} The default build label
 */
export function defaultBuildLabel({
  index,
  total,
  className,
  specName,
  treeData,
  parsedBuild,
}) {
  const ordinal = total === 2 ? (index === 1 ? "A" : "B") : index;
  if (!specName || !className) return `Build ${ordinal}`;
  const heroSpec =
    parsedBuild && treeData
      ? activeHeroSubtree(treeData.nodes, parsedBuild.nodes)
      : null;
  const prefix = heroSpec ? `${heroSpec} ` : "";
  return `Build ${ordinal} — ${prefix}${specName} ${className}`;
}
