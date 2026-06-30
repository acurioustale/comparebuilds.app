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
 * Pure / no-DOM so it lives in src/lib.
 *
 * @param {object} args
 * @param {number} args.index 1-based build number shown in the label
 * @param {string} [args.className] Display name of the class
 * @param {string} [args.specName] Display name of the spec
 * @param {object} [args.treeData] Spec tree data definition (needs `.nodes`)
 * @param {object} [args.parsedBuild] Parsed build object (needs `.nodes`)
 * @returns {string} The default build label
 */
export function defaultBuildLabel({
  index,
  className,
  specName,
  treeData,
  parsedBuild,
}) {
  if (!specName || !className) return `Build ${index}`;
  const heroSpec =
    parsedBuild && treeData
      ? activeHeroSubtree(treeData.nodes, parsedBuild.nodes)
      : null;
  const prefix = heroSpec ? `${heroSpec} ` : "";
  return `Build ${index} — ${prefix}${specName} ${className}`;
}
