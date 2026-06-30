import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { buildDependentsMap, prereqChain } from "./prereqChain.js";

// A small diamond: 1 (root) → 2,3 → 4. posY increases downward, so upperParents
// of a node are its connected neighbours with a smaller posY.
//   1
//  / \
// 2   3
//  \ /
//   4
const NODES = [
  { id: 1, posX: 1, posY: 0, connections: [2, 3] },
  { id: 2, posX: 0, posY: 1, connections: [1, 4] },
  { id: 3, posX: 2, posY: 1, connections: [1, 4] },
  { id: 4, posX: 1, posY: 2, connections: [2, 3] },
];
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
const deps = buildDependentsMap(NODES, byId);

describe("prereqChain", () => {
  test("includes the node, its direct prerequisites, and its direct dependents", () => {
    // Node 2: itself, direct parent 1, direct dependent 4.
    assert.deepStrictEqual([...prereqChain(2, byId, deps)].sort(), [1, 2, 4]);
  });

  test("a leaf includes only its direct parents (no further ancestry, no dependents)", () => {
    // Node 4: itself + its two direct parents 2,3. Node 1 is NOT pulled in (it is
    // two hops up), and there is nothing below 4.
    assert.deepStrictEqual([...prereqChain(4, byId, deps)].sort(), [2, 3, 4]);
  });

  test("a root has only itself and its direct dependents", () => {
    assert.deepStrictEqual([...prereqChain(1, byId, deps)].sort(), [1, 2, 3]);
  });

  test("an unknown id yields an empty set", () => {
    assert.strictEqual(prereqChain(999, byId, deps).size, 0);
  });

  test("tolerates a malformed back-reference (only direct upper parents count)", () => {
    const cyc = [
      { id: 10, posX: 0, posY: 0, connections: [11] },
      { id: 11, posX: 0, posY: 1, connections: [10] },
    ];
    const m = Object.fromEntries(cyc.map((n) => [n.id, n]));
    const cycDeps = buildDependentsMap(cyc, m);
    // 11's only upper parent is 10; the back edge from 10 (downward) is not a parent.
    assert.deepStrictEqual([...prereqChain(11, m, cycDeps)].sort(), [10, 11]);
  });
});

describe("buildDependentsMap", () => {
  test("maps each parent id to the ids of nodes that list it as a direct upper parent", () => {
    // 1 → {2,3}; 2 → {4}; 3 → {4}; 4 has no dependents (nothing below it).
    assert.deepStrictEqual(deps.get(1).sort(), [2, 3]);
    assert.deepStrictEqual(deps.get(2), [4]);
    assert.deepStrictEqual(deps.get(3), [4]);
    assert.strictEqual(deps.get(4), undefined);
  });
});
