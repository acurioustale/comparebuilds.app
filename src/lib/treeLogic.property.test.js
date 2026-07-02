import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "node:module";
import {
  computeInvalidNodeIds,
  spentPoints,
  buildGrantedSeed,
} from "./treeLogic.js";
import { sectionPoints } from "./spendRules.js";

// Property-based coverage for the prereq/gate cascade — the correctness core.
// The example tests (treeLogic.test.js) pin hand-built trees and the real specs'
// full-legal selection; these assert the cascade's structural invariants across
// arbitrary, possibly-illegal selections on real spec data. Sorting legal from
// illegal is exactly the cascade's job, so feeding it random selections is fair.

const require = createRequire(import.meta.url);
const treeData = require("../data/druid.json").specs.feral;
const allNodes = treeData.nodes;
const nodeById = Object.fromEntries(allNodes.map((n) => [n.id, n]));
const purchasable = allNodes.filter((n) => !n.alreadyGranted);
const grantedSeed = buildGrantedSeed(treeData);

// Granted seed plus an arbitrary set of purchased ranks. May well be illegal
// (unmet gates, orphaned picks, both hero subtrees at once) — that's the point.
const selectionArb = fc
  .record(
    Object.fromEntries(
      purchasable.map((n) => [
        n.id,
        fc.option(fc.integer({ min: 1, max: n.maxRanks }), { nil: undefined }),
      ]),
    ),
  )
  .map((obj) => {
    const sel = { ...grantedSeed };
    for (const [id, pts] of Object.entries(obj))
      if (pts !== undefined)
        sel[id] = { pointsInvested: pts, entryChosen: null };
    return sel;
  });

// Upper bound on a section's spent points: one id per co-located cell, at full
// rank, granted excluded. spentPoints can never exceed this.
function sectionCap(treeType) {
  let sum = 0;
  const cells = new Set();
  for (const n of allNodes) {
    if (n.alreadyGranted || n.treeType !== treeType) continue;
    const key = `${n.posX},${n.posY},${n.heroSubtree ?? ""}`;
    if (cells.has(key)) continue;
    cells.add(key);
    sum += n.maxRanks;
  }
  return sum;
}

describe("computeInvalidNodeIds — property-based", () => {
  it("never flags a granted node and only flags currently-selected nodes", () => {
    fc.assert(
      fc.property(selectionArb, (selected) => {
        const invalid = computeInvalidNodeIds(allNodes, selected, nodeById);
        for (const id of invalid) {
          expect(nodeById[id].alreadyGranted).toBe(false);
          expect(selected[id]).toBeTruthy();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(selectionArb, (selected) => {
        const a = [...computeInvalidNodeIds(allNodes, selected, nodeById)].sort(
          (x, y) => x - y,
        );
        const b = [...computeInvalidNodeIds(allNodes, selected, nodeById)].sort(
          (x, y) => x - y,
        );
        expect(a).toEqual(b);
      }),
      { numRuns: 40 },
    );
  });
});

describe("section point tallies — property-based", () => {
  it("spentPoints stays within [0, section cap] and agrees with sectionPoints", () => {
    const cap = {
      class: sectionCap("class"),
      spec: sectionCap("spec"),
      hero: sectionCap("hero"),
    };
    fc.assert(
      fc.property(selectionArb, (selected) => {
        for (const t of ["class", "spec", "hero"]) {
          const sp = spentPoints(allNodes, selected, t);
          expect(sp).toBeGreaterThanOrEqual(0);
          expect(sp).toBeLessThanOrEqual(cap[t]);
          // treeLogic.spentPoints and spendRules.sectionPoints must agree, or the
          // budget shown and the budget enforced would drift.
          expect(sectionPoints(t, allNodes, selected)).toBe(sp);
        }
      }),
      { numRuns: 60 },
    );
  });
});
