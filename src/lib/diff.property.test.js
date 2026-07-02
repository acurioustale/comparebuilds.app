import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "node:module";
import { computeDiff, groupBySection } from "./diff.js";

// Property-based coverage for the two-build diff. Real spec data (druid feral,
// which spans class/spec/hero and has choice + ranked nodes) is the tree; the
// selections are arbitrary. The example tests pin specific diffs; these assert
// the structural invariants — identity, symmetry, and that a node is highlighted
// exactly when the two builds treat it differently — across the input space.

const require = createRequire(import.meta.url);
const allNodes = require("../data/druid.json").specs.feral.nodes;
const purchasable = allNodes.filter((n) => !n.alreadyGranted);

// An arbitrary selection over the real tree (any subset, valid ranks/choices).
const selectionArb = fc
  .record(
    Object.fromEntries(
      purchasable.map((n) => {
        const entry = fc.record({
          pointsInvested: fc.integer({ min: 1, max: n.maxRanks }),
          entryChosen:
            n.type === "choice"
              ? fc.integer({
                  min: 0,
                  max: Math.max(0, (n.choices?.length ?? 1) - 1),
                })
              : fc.constant(null),
        });
        return [n.id, fc.option(entry, { nil: undefined })];
      }),
    ),
  )
  .map((obj) => {
    const sel = {};
    for (const [id, v] of Object.entries(obj)) if (v !== undefined) sel[id] = v;
    return sel;
  });

const idSet = (arr) => new Set(arr.map((e) => e.id));

describe("computeDiff — property-based", () => {
  it("a build diffed against itself is empty", () => {
    fc.assert(
      fc.property(selectionArb, (a) => {
        const d = computeDiff(a, a, allNodes);
        expect(d.aOnly).toEqual([]);
        expect(d.bOnly).toEqual([]);
        expect(d.differing).toEqual([]);
        expect(Object.keys(d.highlights)).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it("is symmetric: swapping A/B swaps a-only/b-only and preserves the diff set", () => {
    fc.assert(
      fc.property(selectionArb, selectionArb, (a, b) => {
        const ab = computeDiff(a, b, allNodes);
        const ba = computeDiff(b, a, allNodes);
        expect(idSet(ab.aOnly)).toEqual(idSet(ba.bOnly));
        expect(idSet(ab.bOnly)).toEqual(idSet(ba.aOnly));
        expect(idSet(ab.differing)).toEqual(idSet(ba.differing));
        expect(new Set(Object.keys(ab.highlights))).toEqual(
          new Set(Object.keys(ba.highlights)),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("highlights exactly the non-granted nodes whose selections differ", () => {
    fc.assert(
      fc.property(selectionArb, selectionArb, (a, b) => {
        const d = computeDiff(a, b, allNodes);
        for (const n of allNodes) {
          if (n.alreadyGranted) continue;
          const sa = a[n.id];
          const sb = b[n.id];
          const differs =
            !!sa !== !!sb ||
            !!(
              sa &&
              sb &&
              (sa.pointsInvested !== sb.pointsInvested ||
                sa.entryChosen !== sb.entryChosen)
            );
          expect(d.highlights[n.id] !== undefined).toBe(differs);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("groupBySection — property-based", () => {
  it("keeps every known-section entry and orders buckets class → spec → hero", () => {
    const entryArb = fc.record({
      node: fc.record({
        treeType: fc.constantFrom("class", "spec", "hero", "bogus"),
      }),
    });
    fc.assert(
      fc.property(fc.array(entryArb), (entries) => {
        const groups = groupBySection(entries);
        const known = entries.filter((e) =>
          ["class", "spec", "hero"].includes(e.node.treeType),
        );
        const grouped = groups.reduce((sum, g) => sum + g.entries.length, 0);
        expect(grouped).toBe(known.length);
        const rankOf = { class: 0, spec: 1, hero: 2 };
        const order = groups.map((g) => g.section);
        expect(order).toEqual([...order].sort((x, y) => rankOf[x] - rankOf[y]));
        for (const g of groups) expect(g.entries.length).toBeGreaterThan(0);
      }),
    );
  });
});
