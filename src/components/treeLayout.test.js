/**
 * Tests for the shared panel-geometry helpers. Pure math, no DOM.
 */

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { panelBounds, PAD, CELL } from "./treeLayout.js";

describe("panelBounds", () => {
  test("computes bounds from node positions", () => {
    const b = panelBounds([
      { posX: 1, posY: 2 },
      { posX: 4, posY: 6 },
    ]);
    assert.strictEqual(b.minX, 1);
    assert.strictEqual(b.minY, 2);
    assert.strictEqual(b.W, (4 - 1) * CELL + PAD * 2);
    assert.strictEqual(b.H, (6 - 2) * CELL + PAD * 2);
  });

  test("returns a finite padding box for an empty panel (no NaN/Infinity)", () => {
    const b = panelBounds([]);
    assert.deepStrictEqual(b, { minX: 0, minY: 0, W: PAD * 2, H: PAD * 2 });
    for (const v of Object.values(b)) assert.ok(Number.isFinite(v));
  });
});
