// NOTE: these limits are mirrored server-side in api/share.php (MAX_BUILDS,
// MAX_BUILD_LEN). Keep the two in sync — the server rejects anything past them, so
// validating here too just gives a clearer message before the share round-trip.
export const MAX_BUILDS = 5;
export const MAX_BUILD_LEN = 2000;
// Per-slot name cap. Mirrored server-side in api/share.php (MAX_LABEL_LEN).
export const MAX_BUILD_NAME_LEN = 40;

// ─── Initial state snapshot (reused for resets) ──────────────────────────────

export const EMPTY = {
  /** @type {string[]} Raw base64 build strings (0 – MAX_BUILDS). */
  buildStrings: [],

  /**
   * User-assigned slot names, parallel to buildStrings. '' = unnamed (the UI
   * shows a computed default). Persisted and carried through both share types.
   * @type {string[]}
   */
  buildNames: [],

  /**
   * Parsed results, parallel to buildStrings. null means either "not yet
   * parsed" (tree data loading) or "failed to parse" (bad string).
   * @type {(object|null)[]}
   */
  parsedBuilds: [],

  /** Spec ID shared by all builds; derived from the first valid import. */
  specId: null,

  /** Class ID derived from specId via the classes index. */
  classId: null,

  /**
   * The normalised spec tree object (classData.specs[specSlug]).
   * Available after tree data is loaded; used for display and comparison.
   * @type {object|null}
   */
  treeData: null,

  /**
   * Flat sorted node list for the whole class, ready for parseBuildString().
   * Null until the first build's class data has been loaded.
   * @type {object[]|null}
   */
  classNodes: null,

  isLoading: false,

  /**
   * Last validation or load error. Set on failure, cleared on the next
   * successful addBuild() call. Never cleared automatically — consumers
   * should clear it after displaying it if desired.
   */
  error: null,

  /**
   * Node selections built interactively (before any build string is imported).
   * Keyed by node ID, parallel structure to parsedBuild.nodes.
   * Cleared whenever the store resets to EMPTY.
   * @type {Record<number, {pointsInvested: number, entryChosen: number|null}>}
   */
  interactiveNodes: {},

  /**
   * True while the user is building an additional build via the interactive
   * tree after at least one build has already been exported.  Drives whether
   * MainView renders the interactive tree alongside the comparison view.
   */
  addingBuild: false,

  /**
   * Index of the build currently being edited in the interactive tree, or null.
   */
  editingIndex: null,

  /** @type {string|null} Structural hash of the active spec tree. */
  layoutHash: null,

  /** @type {string|null} Structural hash restored from a share link. */
  sharedLayoutHash: null,
};
