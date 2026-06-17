/**
 * Behaviour tests for the builds store.
 *
 * These drive the real Zustand store end-to-end: Vitest resolves the
 * `import.meta.glob` data loader, so `addBuild` dynamically imports actual class
 * JSON and parses real (generated) build strings — exercising the spec-identity,
 * dedup, limit, mismatch, reset, and hero-sanitisation logic that had no
 * coverage before.
 */

import { describe, test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { useBuildsStore, MAX_BUILDS } from './buildsStore.js'
import { collectClassNodes, generateBuildString } from '../lib/buildString.js'

const require = createRequire(import.meta.url)
const get = () => useBuildsStore.getState()

const DK_BLOOD = require('../data/death_knight.json').specs.blood.specId
const MAGE_FIRE = require('../data/mage.json').specs.fire.specId

/**
 * Generates `n` distinct, well-formed build strings for one class+spec by
 * selecting the first 1..n non-granted nodes (distinct selections → distinct
 * strings, all sharing the same specId).
 */
function genStrings(classSlug, specSlug, n) {
  const data = require(`../data/${classSlug}.json`)
  const classNodes = collectClassNodes(data)
  const spec = data.specs[specSlug]
  const pickable = spec.nodes.filter((nd) => !nd.alreadyGranted)
  assert.ok(pickable.length >= n, `fixture needs >= ${n} pickable nodes, has ${pickable.length}`)
  const out = []
  for (let k = 1; k <= n; k++) {
    const sel = {}
    for (let i = 0; i < k; i++) {
      const nd = pickable[i]
      sel[nd.id] = {
        pointsInvested: nd.type === 'choice' ? nd.choices[0].maxRanks : nd.maxRanks,
        entryChosen: nd.type === 'choice' ? 0 : null,
      }
    }
    out.push(generateBuildString(sel, spec.specId, classNodes))
  }
  return out
}

beforeEach(() => {
  get().clearAllBuilds()
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('addBuild validation', () => {
  test('rejects a non-string', async () => {
    await get().addBuild(null)
    assert.ok(get().error, 'expected an error')
    assert.strictEqual(get().buildStrings.length, 0)
  })

  test('rejects an unknown spec id', async () => {
    const dk = require('../data/death_knight.json')
    const bogus = generateBuildString({}, 9999, collectClassNodes(dk)) // 9999 ∉ index
    await get().addBuild(bogus)
    assert.match(get().error ?? '', /not found in the local class index/)
    assert.strictEqual(get().buildStrings.length, 0)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('addBuild loads tree data', () => {
  test('accepts a valid string, parses it, and loads the tree', async () => {
    const [s] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(s)
    const st = get()
    assert.strictEqual(st.error, null)
    assert.strictEqual(st.buildStrings.length, 1)
    assert.ok(st.treeData, 'treeData should be loaded')
    assert.ok(st.parsedBuilds[0], 'build should be parsed')
    assert.strictEqual(st.specId, DK_BLOOD)
    assert.ok(Number.isInteger(st.classId), 'classId should be set')
  })
})

// ── Dedup / limit / mismatch ──────────────────────────────────────────────────

describe('addBuild guards', () => {
  test('rejects an exact duplicate', async () => {
    const [s] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(s)
    await get().addBuild(s)
    assert.match(get().error ?? '', /already been added/)
    assert.strictEqual(get().buildStrings.length, 1)
  })

  test('enforces MAX_BUILDS', async () => {
    const strs = genStrings('death_knight', 'blood', MAX_BUILDS + 1)
    for (let i = 0; i < MAX_BUILDS; i++) await get().addBuild(strs[i])
    assert.strictEqual(get().buildStrings.length, MAX_BUILDS)
    assert.strictEqual(get().error, null)
    await get().addBuild(strs[MAX_BUILDS])
    assert.match(get().error ?? '', /at most/)
    assert.strictEqual(get().buildStrings.length, MAX_BUILDS)
  })

  test('rejects a different spec', async () => {
    const [dk] = genStrings('death_knight', 'blood', 1)
    const [mage] = genStrings('mage', 'fire', 1)
    await get().addBuild(dk)
    await get().addBuild(mage)
    assert.match(get().error ?? '', /Spec mismatch/)
    assert.strictEqual(get().buildStrings.length, 1)
    assert.strictEqual(get().specId, DK_BLOOD)
  })
})

// ── Removal / reset ───────────────────────────────────────────────────────────

describe('removeBuild and reset', () => {
  test('removeBuild drops one and keeps the rest', async () => {
    const [a, b] = genStrings('death_knight', 'blood', 2)
    await get().addBuild(a)
    await get().addBuild(b)
    assert.strictEqual(get().buildStrings.length, 2)
    get().removeBuild(0)
    assert.strictEqual(get().buildStrings.length, 1)
    assert.strictEqual(get().buildStrings[0], b)
  })

  test('removeBuild ignores out-of-range indices', async () => {
    const [a] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(a)
    get().removeBuild(5)
    get().removeBuild(-1)
    assert.strictEqual(get().buildStrings.length, 1)
  })

  test('removing the last build resets spec identity', async () => {
    const [a] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(a)
    get().removeBuild(0)
    const st = get()
    assert.strictEqual(st.buildStrings.length, 0)
    assert.strictEqual(st.specId, null)
    assert.strictEqual(st.classId, null)
    assert.strictEqual(st.treeData, null)
  })

  test('clearAllBuilds resets everything', async () => {
    const [a] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(a)
    get().clearAllBuilds()
    const st = get()
    assert.strictEqual(st.buildStrings.length, 0)
    assert.strictEqual(st.specId, null)
    assert.strictEqual(st.treeData, null)
  })
})

// ── preloadSpec ───────────────────────────────────────────────────────────────

describe('preloadSpec', () => {
  test('loads tree data and stays class-unlocked', async () => {
    await get().preloadSpec(DK_BLOOD)
    const st = get()
    assert.strictEqual(st.specId, DK_BLOOD)
    assert.strictEqual(st.classId, null, 'classId stays null so the class grid is unlocked')
    assert.ok(st.treeData)
    assert.strictEqual(typeof st.interactiveNodes, 'object')
  })

  test('is a no-op once builds exist', async () => {
    const [a] = genStrings('death_knight', 'blood', 1)
    await get().addBuild(a)
    const before = get().treeData
    await get().preloadSpec(MAGE_FIRE)
    assert.strictEqual(get().specId, DK_BLOOD)
    assert.strictEqual(get().treeData, before)
  })

  test('ignores an unknown spec id', async () => {
    await get().preloadSpec(999999)
    assert.strictEqual(get().treeData, null)
  })
})

// ── Hero-subtree sanitisation ─────────────────────────────────────────────────

describe('setInteractiveNodes', () => {
  test('strips all but the dominant hero subtree', async () => {
    await get().preloadSpec(DK_BLOOD)
    const td = get().treeData
    const hero = td.nodes.filter((n) => n.treeType === 'hero' && !n.alreadyGranted)
    const leftName = td.heroSubtrees.left.name
    const rightName = td.heroSubtrees.right.name
    const leftNode = hero.find((n) => n.heroSubtree === leftName)
    const rightNodes = hero.filter((n) => n.heroSubtree === rightName).slice(0, 2)
    assert.ok(leftNode && rightNodes.length >= 2, 'fixture needs hero nodes in both subtrees')

    // Left = 1 point, Right = 2 points → Right dominates, Left should be stripped.
    const sel = { ...get().interactiveNodes }
    sel[leftNode.id] = { pointsInvested: 1, entryChosen: null }
    for (const rn of rightNodes) sel[rn.id] = { pointsInvested: 1, entryChosen: null }
    get().setInteractiveNodes(sel)

    const after = get().interactiveNodes
    assert.ok(!after[leftNode.id], 'weaker subtree node should be removed')
    for (const rn of rightNodes) assert.ok(after[rn.id], 'dominant subtree nodes should be kept')
  })

  test('leaves a single active subtree untouched', async () => {
    await get().preloadSpec(DK_BLOOD)
    const td = get().treeData
    const leftName = td.heroSubtrees.left.name
    const leftNode = td.nodes.find((n) => n.treeType === 'hero' && !n.alreadyGranted && n.heroSubtree === leftName)
    const sel = { ...get().interactiveNodes, [leftNode.id]: { pointsInvested: 1, entryChosen: null } }
    get().setInteractiveNodes(sel)
    assert.ok(get().interactiveNodes[leftNode.id], 'lone active subtree should be preserved')
  })
})
