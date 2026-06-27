/**
 * Tests for the wire-layout fingerprint. The fingerprint must change whenever a
 * data edit would shift bit positions OR change how a node's rank decodes, so the
 * committed snapshot turns a silent build-string break into a loud test failure.
 */

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { wireLayout } from "./wireLayout.js";

// Minimal class-data shape that collectClassNodes accepts: a non-choice node and
// a 2-option choice node whose first option's maxRanks we vary.
const data = (optionMaxRanks) => ({
  specs: {
    spec1: {
      nodes: [
        { id: 1, maxRanks: 1, choices: null },
        {
          id: 2,
          maxRanks: 1,
          choices: [{ maxRanks: optionMaxRanks }, { maxRanks: 1 }],
        },
      ],
    },
  },
});

describe("wireLayout fingerprint", () => {
  test("is stable for identical data", () => {
    assert.deepStrictEqual(wireLayout(data(1)), wireLayout(data(1)));
  });

  test("changes when a choice option's maxRanks changes", () => {
    // arity and node.maxRanks are identical; only an option's maxRanks differs —
    // which alters decoded pointsInvested for a full-rank pick of that option.
    const a = wireLayout(data(1));
    const b = wireLayout(data(2));
    assert.strictEqual(a.count, b.count, "node count unchanged");
    assert.notStrictEqual(a.hash, b.hash, "hash must reflect the option maxRanks");
  });
});
