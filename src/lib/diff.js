// ─── Build diff logic ─────────────────────────────────────────────────────────
//
// Pure comparison of two parsed builds. Extracted from SideBySideDiff so it can
// be unit-tested without rendering a component.

/**
 * Returns a human-readable label for what a build selected on a given node.
 * Used in the diff summary panel.
 */
export function selectionLabel(node, sel) {
  if (!sel) return null;
  if (node.type === "choice") {
    // A selected choice node always carries an entryChosen; guard the unknown
    // case (corrupt/partial data) by naming the node rather than faking
    // "option 1" (null + 1), which would mislabel it as the first option.
    if (sel.entryChosen == null) return node.name;
    const ch = node.choices[sel.entryChosen];
    return ch?.name ?? `option ${sel.entryChosen + 1}`;
  }
  if (node.type === "apex" || node.maxRanks > 1) {
    return `${node.name} (${sel.pointsInvested}/${node.maxRanks})`;
  }
  return node.name;
}

/**
 * Computes the diff between two parsed builds.
 *
 * @param {Record<number, {pointsInvested, entryChosen}>} nodesA
 * @param {Record<number, {pointsInvested, entryChosen}>} nodesB
 * @param {object[]} allNodes  Full spec node list from treeData.nodes
 * @returns {{
 *   highlights: Record<number, 'a-only'|'b-only'|'diff'>,
 *   aOnly: object[],
 *   bOnly: object[],
 *   differing: object[]
 * }}
 */
export function computeDiff(nodesA, nodesB, allNodes) {
  const nodeById = {};
  for (const n of allNodes) nodeById[n.id] = n;

  const highlights = {};
  const aOnly = [];
  const bOnly = [];
  const differing = [];

  const allIds = new Set([
    ...Object.keys(nodesA).map(Number),
    ...Object.keys(nodesB).map(Number),
  ]);

  for (const id of allIds) {
    const node = nodeById[id];
    if (!node) continue;
    if (node.alreadyGranted) continue; // always present in both builds

    const selA = nodesA[id];
    const selB = nodesB[id];

    if (selA && !selB) {
      highlights[id] = "a-only";
      aOnly.push({ id, node, selA, selB: null });
    } else if (!selA && selB) {
      highlights[id] = "b-only";
      bOnly.push({ id, node, selA: null, selB });
    } else if (selA && selB) {
      const rankDiff = selA.pointsInvested !== selB.pointsInvested;
      const choiceDiff = selA.entryChosen !== selB.entryChosen;
      if (rankDiff || choiceDiff) {
        highlights[id] = "diff";
        differing.push({ id, node, selA, selB });
      }
    }
  }

  // Sort each group by tree section (class → spec → hero), then posY, then posX
  const sectionOrder = { class: 0, spec: 1, hero: 2 };
  const sortEntries = (arr) =>
    arr.sort((a, b) => {
      const sa = sectionOrder[a.node.treeType] ?? 3;
      const sb = sectionOrder[b.node.treeType] ?? 3;
      if (sa !== sb) return sa - sb;
      if (a.node.posY !== b.node.posY) return a.node.posY - b.node.posY;
      return a.node.posX - b.node.posX;
    });

  return {
    highlights,
    aOnly: sortEntries(aOnly),
    bOnly: sortEntries(bOnly),
    differing: sortEntries(differing),
  };
}
