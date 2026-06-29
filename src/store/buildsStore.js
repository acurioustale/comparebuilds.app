import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { getSafeStorage } from "../lib/safeStorage";
import { createBuildsSlice } from "./slices/buildsSlice";
import {
  MAX_BUILDS,
  MAX_BUILD_LEN,
  MAX_BUILD_NAME_LEN,
  EMPTY,
} from "./slices/constants";
import { createInteractiveSlice } from "./slices/interactiveSlice";

export { MAX_BUILDS, MAX_BUILD_LEN, MAX_BUILD_NAME_LEN };

// ─── Store ────────────────────────────────────────────────────────────────────

const createStore = (set, get) => ({
  ...EMPTY,
  loadGen: 0,
  ...createBuildsSlice(set, get),
  ...createInteractiveSlice(set, get),
});

export const useBuildsStore = create(
  persist(createStore, {
    name: "comparebuilds-state",
    version: 1,
    // Throw (rather than return undefined) when Web Storage is unavailable so
    // createJSONStorage disables persistence cleanly instead of building a
    // wrapper around an undefined store. This keeps the Node test environment,
    // where `localStorage` is not a real Storage, from crashing on writes.
    //
    // When localStorage is unavailable (Vitest, strict webviews, or Safari private
    // mode), provide an in-memory fallback storage implementation so persistence
    // degrades gracefully without dropping writes or throwing errors during active interaction.
    storage: createJSONStorage(getSafeStorage),
    // Persist only the small, serialisable slices. treeData/classNodes/
    // parsedBuilds are derived and rebuilt on rehydration via rehydrateTreeData.
    partialize: (state) => ({
      buildStrings: state.buildStrings,
      buildNames: state.buildNames,
      specId: state.specId,
      classId: state.classId,
      interactiveNodes: state.interactiveNodes,
      addingBuild: state.addingBuild,
      editingIndex: state.editingIndex,
    }),
    // Forward-compat hook: if the persisted shape ever changes, bump `version`
    // above and translate older payloads here. v1 is the initial shape, so this
    // is a passthrough; returning the state unchanged keeps current saves valid.
    migrate: (persisted) => persisted,
  }),
);
