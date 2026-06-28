import { createContext, useContext } from "react";

// Shared emphasis state so any tree node (TalentNode, HeatmapNode) can dim/emphasise
// itself without threading props through TreePanel / SideBySideDiff / Heatmap. Two
// independent providers, both wired in MainView:
//
//   SearchContext        — the search box: dim everything that isn't a match.
//   ChangesFilterContext — the "changes only" toggle (comparison views): dim every
//                          node the builds agree on, keeping only the differences.
//
// Both fold into one opacity clamp (see useNodeEmphasis) so the dim behaviour can't
// drift between the renderers.
//
//   active   — true while there is a non-empty query
//   matchIds — Set<number> of node ids that match (empty when inactive)
export const SearchContext = createContext({ active: false, matchIds: null });

// true while the comparison's "changes only" filter is on. Defaults false, so the
// single-tree and interactive views (which never provide it) are unaffected.
export const ChangesFilterContext = createContext(false);

export const SpotlightContext = createContext(null);

// The blue ring drawn around a node that matches the active search query.
const SEARCH_RING =
  "0 0 0 2px rgba(110,200,255,0.95), 0 0 12px rgba(110,200,255,0.55)";

// Opacity a de-emphasised node is clamped down to.
const DIM = 0.12;

/**
 * Per-node emphasis styling, combining the search query and the changes-only
 * filter. Shared by TalentNode and HeatmapNode so the dim/ring behaviour can't
 * drift between the two renderers.
 *
 * A node is dimmed when a search is active and it is NOT a match, OR when the
 * changes filter is on and it is NOT a change. `isChange` is the renderer's own
 * notion of a difference (diff: node differs between builds; heatmap: contested
 * adoption) — it only matters while the changes filter is active, so it defaults
 * to true for callers that never opt into the filter.
 *
 * @param {number} nodeId
 * @param {boolean} [isChange=true]
 * @returns {{
 *   searchHit: boolean,      // this node matches the query
 *   searchDimmed: boolean,   // a query is active and this node is NOT a match
 *   effOpacity: (base:number)=>number, // clamps a base opacity down when dimmed
 *   searchRing: string|null  // the match-ring shadow string, or null
 * }}
 */
export function useNodeEmphasis(nodeId, isChange = true) {
  const { active, matchIds } = useContext(SearchContext);
  const changesOnly = useContext(ChangesFilterContext);
  const spotlightId = useContext(SpotlightContext);
  const searchHit = active && matchIds ? matchIds.has(nodeId) : false;
  const searchDimmed = active && matchIds ? !searchHit : false;
  const changesDimmed = changesOnly && !isChange;
  const spotlightDimmed = spotlightId != null && spotlightId !== nodeId;
  const dimmed = searchDimmed || changesDimmed;
  return {
    searchHit,
    searchDimmed,
    effOpacity: (base) =>
      dimmed
        ? Math.min(base, DIM)
        : spotlightDimmed
          ? Math.min(base, 0.3)
          : base,
    searchRing: searchHit ? SEARCH_RING : null,
  };
}
