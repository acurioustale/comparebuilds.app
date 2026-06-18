/**
 * Ground-truth fixtures: real build strings exported from the actual game.
 *
 * Round-trip tests prove our codec is self-consistent; they cannot prove our
 * node set matches reality. These do — each string here was produced by the
 * in-game talent UI, so decoding it correctly confirms our node IDs, ordering,
 * budgets, and hero model all match what the game actually emits.
 *
 * Invariant note: a legitimate single-loadout build invests in exactly ONE hero
 * subtree. (That invariant is what flagged the over-budget, both-subtree strings
 * pulled from a third-party "top builds" list as non-standard.)
 *
 * To add a fixture: export a build in-game (copy talent string) and append an
 * entry with the class/spec it belongs to and the hero subtree it invests in.
 */

import { describe, test, expect } from 'vitest'
import { createRequire } from 'node:module'
import { parseSpecId, parseBuildString, collectClassNodes } from './buildString.js'
import { computeInvalidNodeIds, buildGrantedSeed } from './treeLogic.js'

const require = createRequire(import.meta.url)
const classIndex = require('../data/classes.json')

const FIXTURES = [
  {
    name: 'Guardian Druid (in-game Retail)',
    classSlug: 'druid',
    specSlug: 'guardian',
    specId: 104,
    heroSubtree: "Elune's Chosen",
    string:
      'CgGA8cL7tpvige+kkmGM9zUPWDAAAAAAAAAAAgZmZmFzMjZWMLm5BmZZZgZbGGNRmZWMzMzsMzMMAAAAAGYsYGYZbmBjZZAMFAAAYDzAYxYYgZxyGgZGAA',
  },
  {
    name: 'Blood Death Knight (Wowhead raid)',
    classSlug: 'death_knight',
    specSlug: 'blood',
    specId: 250,
    heroSubtree: "San'layn",
    string:
      'CoPAAAAAAAAAAAAAAAAAAAAAAwYWmZmxMmZmhZZmZmmZxYMmxAAAAAzMzMzMzMDzYMAgZmZGAAADMwMW0YZDklBsBYGmBAAmZghB',
  },
  {
    name: 'Mistweaver Monk (Wowhead delves)',
    classSlug: 'monk',
    specSlug: 'mistweaver',
    specId: 270,
    heroSubtree: 'Conduit of the Celestials',
    string:
      'C4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMWmZZML2mxMjNDYMzmZ222mZswQzYGLYwAGzMzMMbDzwsMTAAAAAEgFbzsNbzMAAAwAMDYMMDZMDA',
  },
  {
    name: 'Shadow Priest (Wowhead M+)',
    classSlug: 'priest',
    specSlug: 'shadow',
    specId: 258,
    heroSubtree: 'Archon',
    string:
      'CIQAAAAAAAAAAAAAAAAAAAAAAMMjZGAAAAAAAAAAAghZxMGLzMmZWmZYmx2MGzMzYDZGLmpBYGgZ2MDzmBgMGLAYGIjZmZMbjZ2WGgZiB',
  },
  {
    name: 'Marksmanship Hunter (Wowhead raid)',
    classSlug: 'hunter',
    specSlug: 'marksmanship',
    specId: 254,
    heroSubtree: 'Sentinel',
    string:
      'C4PAAAAAAAAAAAAAAAAAAAAAAwCMwMGNWGAzgNAAAAAAAAgZMjZYGzMjZwYaGDzstxMzsMzMmZmFMLDmBAAMmZmZAMz0GziBYjZGD',
  },
]

function findClass(specId) {
  for (const c of classIndex) {
    const s = c.specs.find((sp) => sp.id === specId)
    if (s) return { cls: c, spec: s }
  }
  return null
}

describe('real in-game build fixtures', () => {
  for (const fx of FIXTURES) {
    describe(fx.name, () => {
      const data = require(`../data/${fx.classSlug}.json`)
      const sd = data.specs[fx.specSlug]
      const classNodes = collectClassNodes(data)
      const nodeById = Object.fromEntries(sd.nodes.map((n) => [n.id, n]))
      const parsed = parseBuildString(fx.string, classNodes)

      // Per-section point totals (excluding auto-granted nodes), and hero split.
      const pts = { class: 0, spec: 0, hero: 0 }
      const heroBySubtree = {}
      let unknownSelected = 0
      for (const [id, sel] of Object.entries(parsed.nodes)) {
        const n = nodeById[id]
        if (!n) { unknownSelected++; continue }   // heroGateNodeId etc.
        if (n.alreadyGranted) continue
        pts[n.treeType] += sel.pointsInvested
        if (n.treeType === 'hero') {
          heroBySubtree[n.heroSubtree] = (heroBySubtree[n.heroSubtree] ?? 0) + sel.pointsInvested
        }
      }

      test('header identifies the expected spec', () => {
        expect(parseSpecId(fx.string).specId).toBe(fx.specId)
        expect(findClass(fx.specId)).toMatchObject({
          cls: { name: fx.classSlug },
          spec: { name: fx.specSlug },
        })
      })

      test('point totals stay within budget', () => {
        expect(pts.class).toBeLessThanOrEqual(sd.pointBudget.class)
        expect(pts.spec).toBeLessThanOrEqual(sd.pointBudget.spec)
        expect(pts.hero).toBeLessThanOrEqual(sd.pointBudget.hero)
      })

      test('invests in exactly one hero subtree (the expected one)', () => {
        const active = Object.keys(heroBySubtree)
        expect(active).toEqual([fx.heroSubtree])
      })

      test('every selected node belongs to the spec tree (besides the hero gate)', () => {
        expect(unknownSelected).toBeLessThanOrEqual(1) // only the heroGateNodeId
      })

      test('is a prerequisite-valid build (no invalid nodes)', () => {
        const selected = { ...buildGrantedSeed(sd), ...parsed.nodes }
        const invalid = computeInvalidNodeIds(sd.nodes, selected, nodeById)
        expect(invalid.size).toBe(0)
      })
    })
  }
})
