import { describe, test, expect } from "vitest";
import { defaultBuildLabel } from "./buildLabel";

describe("defaultBuildLabel", () => {
  const treeData = {
    nodes: [
      {
        id: 101,
        treeType: "hero",
        name: "Hero Node",
        heroSubtree: "San'layn",
      },
    ],
  };

  test("includes the active hero subtree prefix when one is selected", () => {
    const parsedBuild = { nodes: { 101: { pointsInvested: 1 } } };
    expect(
      defaultBuildLabel({
        index: 1,
        className: "Death Knight",
        specName: "Blood",
        treeData,
        parsedBuild,
      }),
    ).toBe("Build 1 — San'layn Blood Death Knight");
  });

  test("omits the hero prefix when no hero subtree is active", () => {
    const parsedBuild = { nodes: {} };
    expect(
      defaultBuildLabel({
        index: 2,
        className: "Death Knight",
        specName: "Blood",
        treeData,
        parsedBuild,
      }),
    ).toBe("Build 2 — Blood Death Knight");
  });

  test("omits the hero prefix when tree data or parse is missing", () => {
    expect(
      defaultBuildLabel({
        index: 3,
        className: "Death Knight",
        specName: "Blood",
        treeData: null,
        parsedBuild: null,
      }),
    ).toBe("Build 3 — Blood Death Knight");
  });

  test("collapses to 'Build N' when class or spec name is absent", () => {
    expect(
      defaultBuildLabel({
        index: 4,
        className: "Death Knight",
        specName: "",
        treeData,
        parsedBuild: { nodes: { 101: { pointsInvested: 1 } } },
      }),
    ).toBe("Build 4");
    expect(
      defaultBuildLabel({
        index: 5,
        className: undefined,
        specName: "Blood",
        treeData,
        parsedBuild: { nodes: { 101: { pointsInvested: 1 } } },
      }),
    ).toBe("Build 5");
  });
});
