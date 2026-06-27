// ─── Interactive spend rules ──────────────────────────────────────────────────
//
// Pure rules governing whether a point may be spent on a node in the interactive
// calculator. Extracted from InteractiveTalentTree so the spend logic — section
// budgets, hero-subtree exclusivity, gates, and prerequisites — can be unit-tested
// without a DOM.

import { hasUpperPrereq, gatedPoints, spentPoints } from "./treeLogic.js";

/**
 * Total points spent in a tree section (class/spec/hero), excluding granted nodes.
 */
export function sectionPoints(treeType, allNodes, selected) {
  return spentPoints(allNodes, selected, treeType);
}

/**
 * Name of the hero subtree the player has committed to (first selected, non-granted
 * hero node), or null if none yet.
 */
export function activeHeroSubtree(allNodes, selected) {
  for (const n of allNodes) {
    if (n.treeType === "hero" && !n.alreadyGranted && selected[n.id])
      return n.heroSubtree;
  }
  return null;
}

/**
 * The budget of a named hero subtree, or null if it can't be resolved. The hero
 * budget is per-subtree because the two subtrees can differ in spendable size
 * (e.g. monk's Conduit of the Celestials has more nodes than its partner), so a
 * single section number can't be right for both.
 */
function subtreeBudget(heroSubtrees, name) {
  for (const side of ["left", "right"]) {
    const sub = heroSubtrees?.[side];
    if (sub?.name === name && Number.isInteger(sub.budget)) return sub.budget;
  }
  return null;
}

/**
 * The point cap for the section `node` belongs to. class/spec are single per-spec
 * numbers; hero resolves to the node's own subtree budget (falling back to the
 * section-wide pointBudget.hero when subtree budgets aren't available).
 */
function sectionBudget(node, budget, heroSubtrees) {
  if (node.treeType !== "hero") return budget[node.treeType];
  return subtreeBudget(heroSubtrees, node.heroSubtree) ?? budget.hero;
}

/**
 * The hero-section point budget that currently applies for the "X / Y" counters:
 * the committed subtree's budget, or — before any subtree is chosen — the
 * section-wide cap (pointBudget.hero, the larger of the two subtrees).
 *
 * @param {{nodes:object[], pointBudget:object, heroSubtrees:object}} treeData
 * @param {object} selected
 */
export function heroSectionBudget(treeData, selected) {
  const active = activeHeroSubtree(treeData.nodes, selected);
  if (active === null) return treeData.pointBudget.hero;
  return (
    subtreeBudget(treeData.heroSubtrees, active) ?? treeData.pointBudget.hero
  );
}

/**
 * Whether a point may currently be spent on `node`, considering: granted status,
 * hero-subtree exclusivity, the section point budget, the node's gate threshold,
 * and its upper prerequisite.
 *
 * @param {object} node
 * @param {object[]} allNodes
 * @param {object} selected   selection map (incl. granted seed)
 * @param {object} nodeById   id → node
 * @param {{class:number, spec:number, hero:number}} budget
 * @param {object} [heroSubtrees]  spec heroSubtrees ({left,right} with per-subtree budgets)
 * @returns {boolean}
 */
export function canSpendPoint(
  node,
  allNodes,
  selected,
  nodeById,
  budget,
  heroSubtrees,
) {
  if (node.alreadyGranted) return false;
  if (node.treeType === "hero") {
    const activeSub = activeHeroSubtree(allNodes, selected);
    if (activeSub !== null && activeSub !== node.heroSubtree) return false;
  }
  if (
    sectionPoints(node.treeType, allNodes, selected) >=
    sectionBudget(node, budget, heroSubtrees)
  )
    return false;
  if (gatedPoints(node, allNodes, selected) < node.spentRequired) return false;
  return hasUpperPrereq(node, selected, nodeById);
}
