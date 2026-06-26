import { describe, test, expect } from "vitest";
import { iconUrl, onIconError } from "./iconUrl.js";

// The transparent 1x1 gif the helpers fall back to. Recovered via iconUrl(null)
// rather than duplicating the literal, so the test tracks the source of truth.
const BLANK = iconUrl(null);

describe("iconUrl", () => {
  test("builds a same-origin, lowercased /talent-icons path", () => {
    expect(iconUrl("Ability_Foo")).toBe("/talent-icons/ability_foo.jpg");
  });

  test("falls back to the blank pixel for a missing icon name", () => {
    expect(iconUrl("")).toBe(BLANK);
    expect(iconUrl(null)).toBe(BLANK);
    expect(iconUrl(undefined)).toBe(BLANK);
    expect(BLANK.startsWith("data:image/gif;base64,")).toBe(true);
  });
});

describe("onIconError", () => {
  test("swaps a failed icon for the blank pixel", () => {
    const target = { src: "/talent-icons/missing.jpg" };
    onIconError({ currentTarget: target });
    expect(target.src).toBe(BLANK);
  });

  test("does not re-assign once already blank (no error loop)", () => {
    let writes = 0;
    const target = {
      _src: BLANK,
      get src() {
        return this._src;
      },
      set src(v) {
        writes++;
        this._src = v;
      },
    };
    onIconError({ currentTarget: target });
    expect(writes).toBe(0);
    expect(target.src).toBe(BLANK);
  });
});
