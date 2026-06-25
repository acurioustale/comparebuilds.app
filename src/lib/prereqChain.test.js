import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { prereqChain } from './prereqChain.js'

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
]
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))

describe('prereqChain', () => {
  test('includes the node, its direct prerequisites, and its direct dependents', () => {
    // Node 2: itself, direct parent 1, direct dependent 4.
    assert.deepStrictEqual([...prereqChain(2, NODES, byId)].sort(), [1, 2, 4])
  })

  test('a leaf includes only its direct parents (no further ancestry, no dependents)', () => {
    // Node 4: itself + its two direct parents 2,3. Node 1 is NOT pulled in (it is
    // two hops up), and there is nothing below 4.
    assert.deepStrictEqual([...prereqChain(4, NODES, byId)].sort(), [2, 3, 4])
  })

  test('a root has only itself and its direct dependents', () => {
    assert.deepStrictEqual([...prereqChain(1, NODES, byId)].sort(), [1, 2, 3])
  })

  test('an unknown id yields an empty set', () => {
    assert.strictEqual(prereqChain(999, NODES, byId).size, 0)
  })

  test('tolerates a malformed back-reference (only direct upper parents count)', () => {
    const cyc = [
      { id: 10, posX: 0, posY: 0, connections: [11] },
      { id: 11, posX: 0, posY: 1, connections: [10] },
    ]
    const m = Object.fromEntries(cyc.map((n) => [n.id, n]))
    // 11's only upper parent is 10; the back edge from 10 (downward) is not a parent.
    assert.deepStrictEqual([...prereqChain(11, cyc, m)].sort(), [10, 11])
  })
})
