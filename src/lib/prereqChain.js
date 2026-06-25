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

import { upperParents } from './treeLogic.js'

/**
 * @param {number} nodeId   the hovered node
 * @param {object[]} nodes  treeData.nodes (or a panel's subset)
 * @param {object} nodeById id → node map
 * @returns {Set<number>}
 */
export function prereqChain(nodeId, nodes, nodeById) {
  const ids = new Set()
  const start = nodeById[nodeId]
  if (!start) return ids

  ids.add(nodeId)

  // Direct prerequisites: connected nodes strictly above.
  for (const parent of upperParents(start, nodeById)) ids.add(parent.id)

  // Direct dependents: nodes that list the hovered node as an upper parent.
  for (const n of nodes) {
    if (upperParents(n, nodeById).some((p) => p.id === nodeId)) ids.add(n.id)
  }

  return ids
}
