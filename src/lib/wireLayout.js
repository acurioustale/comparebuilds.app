/**
 * src/lib/wireLayout.js
 *
 * Computes a fingerprint of a class's build-string "wire layout" — the ordered
 * set of node IDs (with their rank/choice arity) that determines every node's
 * bit position in a serialised build string.
 *
 * Why this exists: the app derives the serialisation node set from the data via
 * collectClassNodes(). If a data edit (or a source swap) adds, removes, or
 * reorders a node, OR changes a node's maxRanks / choice count, then every
 * existing build string for that class shifts its bit positions and silently
 * misparses — no error, just wrong talents and broken share links.
 *
 * A committed snapshot of these fingerprints turns that silent break into a loud
 * test failure: a legitimate ingest regenerates the snapshot (visible in the
 * diff as "the wire format changed"), while an accidental hand-edit fails the
 * snapshot test until someone consciously regenerates it.
 *
 * Node-only (uses node:crypto); never imported by the browser app.
 */

import { createHash } from 'node:crypto'
import { collectClassNodes } from './buildString.js'

/**
 * @param {object} classData  Parsed src/data/{slug}.json
 * @returns {{ count: number, hash: string }}  Stable fingerprint of the wire layout
 */
export function wireLayout(classData) {
  const nodes = collectClassNodes(classData)
  // id + maxRanks + choice arity fully determine each node's bit footprint and
  // position. Joined in collectClassNodes' ascending-id order.
  const signature = nodes
    .map((n) => `${n.id}:${n.maxRanks}:${n.choices?.length ?? 0}`)
    .join('|')
  return {
    count: nodes.length,
    hash: createHash('sha256').update(signature).digest('hex').slice(0, 16),
  }
}
