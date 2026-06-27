/**
 * Tests for the interactive spend rules extracted from InteractiveTalentTree.
 * canSpendPoint integrates the real gate/prereq helpers from treeLogic.
 */

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  sectionPoints,
  activeHeroSubtree,
  canSpendPoint,
  heroSectionBudget,
} from "./spendRules.js";

function node(id, treeType, posY, opts = {}) {
  return {
    id,
    treeType,
    posY,
    posX: opts.posX ?? 0,
    maxRanks: opts.maxRanks ?? 1,
    spentRequired: opts.spentRequired ?? 0,
    connections: opts.connections ?? [],
    alreadyGranted: opts.alreadyGranted ?? false,
    heroSubtree: opts.heroSubtree,
  };
}

const ROOT = node(1, "class", 0);
const CHILD = node(2, "class", 1, { connections: [1] });
const GATED = node(3, "class", 1, {
  posX: 1,
  spentRequired: 5,
  connections: [1],
});
const GRANTED = node(4, "class", 0, { posX: 2, alreadyGranted: true });
const HERO_L = node(10, "hero", 0, { heroSubtree: "Left" });
const HERO_R = node(11, "hero", 0, { heroSubtree: "Right" });

const ALL = [ROOT, CHILD, GATED, GRANTED, HERO_L, HERO_R];
const byId = Object.fromEntries(ALL.map((n) => [n.id, n]));
const pt = (pointsInvested = 1) => ({ pointsInvested, entryChosen: null });
const BUDGET = { class: 10, spec: 10, hero: 10 };

describe("sectionPoints", () => {
  test("sums a section, excluding granted nodes", () => {
    const selected = { 1: pt(), 2: pt(), 4: pt() }; // 4 is granted
    assert.strictEqual(sectionPoints("class", ALL, selected), 2);
  });
  test("returns 0 for an empty section", () => {
    assert.strictEqual(sectionPoints("hero", ALL, {}), 0);
  });
});

describe("activeHeroSubtree", () => {
  test("returns the first selected non-granted hero subtree", () => {
    assert.strictEqual(activeHeroSubtree(ALL, { 11: pt() }), "Right");
  });
  test("returns null when no hero node is selected", () => {
    assert.strictEqual(activeHeroSubtree(ALL, { 1: pt() }), null);
  });
});

describe("canSpendPoint", () => {
  test("granted nodes can never be spent on", () => {
    assert.strictEqual(canSpendPoint(GRANTED, ALL, {}, byId, BUDGET), false);
  });

  test("blocked when the upper prerequisite is unmet", () => {
    assert.strictEqual(canSpendPoint(CHILD, ALL, {}, byId, BUDGET), false);
  });

  test("allowed once the prerequisite is satisfied", () => {
    assert.strictEqual(
      canSpendPoint(CHILD, ALL, { 1: pt() }, byId, BUDGET),
      true,
    );
  });

  test("blocked when the section budget is exhausted", () => {
    // prereq met (root full) but class budget of 1 already spent on the root
    assert.strictEqual(
      canSpendPoint(CHILD, ALL, { 1: pt() }, byId, { ...BUDGET, class: 1 }),
      false,
    );
  });

  test("blocked when the gate threshold is not met", () => {
    // GATED needs 5 points in the section; only 1 is spent
    assert.strictEqual(
      canSpendPoint(GATED, ALL, { 1: pt() }, byId, BUDGET),
      false,
    );
  });

  test("allowed when the gate threshold is met", () => {
    const lowGate = node(3, "class", 1, {
      posX: 1,
      spentRequired: 1,
      connections: [1],
    });
    const all = [ROOT, lowGate];
    const ids = Object.fromEntries(all.map((n) => [n.id, n]));
    assert.strictEqual(
      canSpendPoint(lowGate, all, { 1: pt() }, ids, BUDGET),
      true,
    );
  });

  test("hero subtree exclusivity blocks the other subtree", () => {
    // Left is active; spending on a Right node is blocked
    assert.strictEqual(
      canSpendPoint(HERO_R, ALL, { 10: pt() }, byId, BUDGET),
      false,
    );
  });

  test("first hero node of either subtree is allowed", () => {
    assert.strictEqual(canSpendPoint(HERO_R, ALL, {}, byId, BUDGET), true);
  });

  test("a hero node is capped by its own subtree's budget, not the section max", () => {
    // Two nodes in the "Left" subtree; Left's budget is 1 while the section max
    // (budget.hero) is 3 — the asymmetric case (cf. monk's Conduit vs partner).
    const L1 = node(20, "hero", 0, { heroSubtree: "Left" });
    const L2 = node(21, "hero", 0, { heroSubtree: "Left" });
    const all = [L1, L2];
    const ids = Object.fromEntries(all.map((n) => [n.id, n]));
    const budget = { class: 10, spec: 10, hero: 3 };
    const heroSubtrees = {
      left: { name: "Left", budget: 1 },
      right: { name: "Right", budget: 3 },
    };
    // 1 point already spent in Left (its whole budget): a second Left node is
    // blocked by the per-subtree budget even though the section max isn't hit.
    assert.strictEqual(
      canSpendPoint(L2, all, { 20: pt() }, ids, budget, heroSubtrees),
      false,
    );
    // Without subtree budgets it falls back to budget.hero (3) and allows it —
    // confirming the per-subtree resolution is what blocks it.
    assert.strictEqual(canSpendPoint(L2, all, { 20: pt() }, ids, budget), true);
  });
});

describe("heroSectionBudget", () => {
  const treeData = {
    nodes: ALL,
    pointBudget: { class: 10, spec: 10, hero: 15 },
    heroSubtrees: {
      left: { name: "Left", budget: 15 },
      right: { name: "Right", budget: 13 },
    },
  };

  test("uses the committed subtree's own budget", () => {
    // Right subtree active → its budget (13), not the section max (15).
    assert.strictEqual(heroSectionBudget(treeData, { 11: pt() }), 13);
  });

  test("falls back to the section max before a subtree is chosen", () => {
    assert.strictEqual(heroSectionBudget(treeData, {}), 15);
  });
});
