// @vitest-environment jsdom
/**
 * Regression coverage for the copy-state reset timers. They are scheduled in an
 * async finally that runs after the share promise settles — which can be after
 * the component unmounts. The unmount cleanup must not leave an orphan timer
 * that fires setState on a removed component.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShareActions } from "./useShareActions.js";
import { createServerShare } from "../lib/shareLink.js";

vi.mock("../lib/shareLink.js", () => ({ createServerShare: vi.fn() }));

const baseProps = {
  classId: 6,
  specId: 250,
  buildStrings: ["x"],
  buildNames: [""],
  classDisplayName: "Death Knight",
  specDisplayName: "Blood",
  treeData: {},
  parsedBuilds: [null],
  layoutHash: "h",
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useShareActions copy-link reset timer", () => {
  test("does not schedule a reset timer when unmounted before the share resolves", async () => {
    let resolveShare;
    createServerShare.mockReturnValue(
      new Promise((r) => {
        resolveShare = r;
      }),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { result, unmount } = renderHook(() => useShareActions(baseProps));

    // Kick off the copy; the share promise stays pending.
    act(() => {
      result.current.handleCopyLink();
    });
    // The component is removed before the share settles.
    unmount();

    await act(async () => {
      resolveShare({ id: "abc123xy" });
      await flush();
    });

    // No 2s reset timer was scheduled after unmount — nothing would clear it.
    const resetTimers = setTimeoutSpy.mock.calls.filter(([, d]) => d === 2000);
    expect(resetTimers).toHaveLength(0);
  });

  test("schedules the reset timer on the happy path while still mounted", async () => {
    createServerShare.mockResolvedValue({ id: "abc123xy" });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { result } = renderHook(() => useShareActions(baseProps));

    await act(async () => {
      await result.current.handleCopyLink();
      await flush();
    });

    expect(result.current.copyState).toBe("copied");
    const resetTimers = setTimeoutSpy.mock.calls.filter(([, d]) => d === 2000);
    expect(resetTimers).toHaveLength(1);
  });
});
