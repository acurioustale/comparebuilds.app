// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DiffSummaryTable from "./DiffSummaryTable.jsx";

afterEach(cleanup);

const NODE_A = {
  id: 1,
  type: "active",
  treeType: "spec",
  maxRanks: 2,
  posX: 0,
  posY: 0,
  name: "Node A",
};
const CHOICE = {
  id: 2,
  type: "choice",
  treeType: "spec",
  maxRanks: 1,
  posX: 0,
  posY: 1,
  name: null,
  choices: [{ name: "Opt1" }, { name: "Opt2" }],
};
const treeData = { nodes: [NODE_A, CHOICE] };

const noop = () => {};

describe("DiffSummaryTable", () => {
  test("two-build mode lists differing nodes with per-build values", () => {
    const valid = [
      {
        parsed: { nodes: { 1: { pointsInvested: 2, entryChosen: null } } },
        label: "A",
      },
      {
        parsed: { nodes: { 1: { pointsInvested: 1, entryChosen: null } } },
        label: "B",
      },
    ];
    render(
      <DiffSummaryTable
        treeData={treeData}
        valid={valid}
        setSpotlightId={noop}
      />,
    );
    expect(screen.getByText("Node A")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  // Regression guard: every build takes the choice node, but the picks diverge.
  // The old count-only check (count < total) missed this; isDivergent catches it.
  test("3+ mode flags a choice node all builds take but pick differently", () => {
    const valid = [
      { parsed: { nodes: { 2: { entryChosen: 0 } } }, label: "A" },
      { parsed: { nodes: { 2: { entryChosen: 1 } } }, label: "B" },
      { parsed: { nodes: { 2: { entryChosen: 0 } } }, label: "C" },
    ];
    render(
      <DiffSummaryTable
        treeData={treeData}
        valid={valid}
        setSpotlightId={noop}
      />,
    );
    expect(screen.getByText(/picks differ \(3\/3\)/)).toBeInTheDocument();
  });

  test("hovering a row spotlights the node", () => {
    const setSpotlightId = vi.fn();
    const valid = [
      {
        parsed: { nodes: { 1: { pointsInvested: 2, entryChosen: null } } },
        label: "A",
      },
      { parsed: { nodes: {} }, label: "B" },
    ];
    render(
      <DiffSummaryTable
        treeData={treeData}
        valid={valid}
        setSpotlightId={setSpotlightId}
      />,
    );
    fireEvent.mouseEnter(screen.getByText("Node A").closest("tr"));
    expect(setSpotlightId).toHaveBeenCalledWith(1);
  });
});
