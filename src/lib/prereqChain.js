// ─── Prerequisite links ───────────────────────────────────────────────────────
//
// Pure helper for the hover highlight: given a node, returns the set of node ids
// directly relevant to it — the node itself, its direct prerequisites (the
// connected nodes immediately above), and its direct dependents (nodes immediately
// below that connect to it). Reuses treeLogic.upperParents so "what sits above me"
// matches the prereq/gate cascade exactly.
//
// We deliberately stay one hop in each direction rather than walking the full
// transitive ancestry: a talent node unlocks when ANY one direct upper parent is
// satisfied (see hasUpperPrereq), and in these dense trees the full ancestry of a
// deep node is most of the panel — too noisy to read. One hop shows exactly the
// links that gate (and are gated by) the hovered node.

import { upperParents } from "./treeLogic.js";

/**
 * Precomputes the child→parents adjacency in reverse: a map from each upper-parent
 * id to the ids of the nodes that list it as a direct upper parent (its dependents).
 * Built once per node list so the per-hover dependents lookup is a single map read
 * instead of rescanning every node and re-running upperParents on each.
 *
 * @param {object[]} nodes treeData.nodes (or a panel's subset)
 * @param {Record<number, object>} nodeById id → node map
 * @returns {Map<number, number[]>} parent id → array of dependent node ids
 */
export function buildDependentsMap(nodes, nodeById) {
  const dependents = new Map();
  for (const n of nodes) {
    for (const parent of upperParents(n, nodeById)) {
      const list = dependents.get(parent.id);
      if (list) list.push(n.id);
      else dependents.set(parent.id, [n.id]);
    }
  }
  return dependents;
}

/**
 * @param {number} nodeId the hovered node ID
 * @param {Record<number, object>} nodeById id → node map
 * @param {Map<number, number[]>} dependentsMap parent id → dependent ids, from buildDependentsMap
 * @returns {Set<number>} Set of relevant node IDs in prereq chain
 */
export function prereqChain(nodeId, nodeById, dependentsMap) {
  const ids = new Set();
  const start = nodeById[nodeId];
  if (!start) return ids;

  ids.add(nodeId);

  // Direct prerequisites: connected nodes strictly above.
  for (const parent of upperParents(start, nodeById)) ids.add(parent.id);

  // Direct dependents: nodes that list the hovered node as an upper parent.
  const deps = dependentsMap.get(nodeId);
  if (deps) for (const id of deps) ids.add(id);

  return ids;
}
