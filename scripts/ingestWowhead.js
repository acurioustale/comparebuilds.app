/**
 * ingestWowhead.js
 * ----------------
 * Second talent-data source: maps Wowhead's calculator feed to the same
 * normalised schema as the Icy Veins ingest (src/data/{slug}.json), so the app's
 * data contract is independent of any single upstream.
 *
 * Why a second source: keeps us from being hostage to one site being offline,
 * slow to update for a new patch, or changing its shape. Wowhead uses Blizzard's
 * own trait-node IDs (as does Icy Veins and the game itself), so build strings
 * and share links stay interchangeable across sources — the proof of that is the
 * wire-layout snapshot (src/lib/wireLayout.snapshot.json): a source whose
 * per-class fingerprints match the committed snapshot is build-string-compatible.
 *
 * Roles (see CLAUDE.md "Data is the contract"):
 *   - Icy Veins remains the PRIMARY, snapshot-owning source.
 *   - Wowhead runs in VERIFY mode by default: it validates, fingerprints, and
 *     compares against the committed snapshot + current src/data/, printing a
 *     report, WITHOUT writing anything. This is the cross-validation / fallback-
 *     readiness check.
 *   - `--promote` makes Wowhead the writer (writes src/data/), the fallback
 *     switch for when Icy Veins is behind/down. `--update-snapshot` additionally
 *     regenerates the snapshot — only do that deliberately (it redefines the
 *     build-string oracle).
 *
 * Run:
 *   node scripts/ingestWowhead.js                 # verify all classes, write nothing
 *   node scripts/ingestWowhead.js --class=warrior # verify a single class (spike)
 *   node scripts/ingestWowhead.js --no-descriptions# skip the per-spell tooltip fetch
 *   node scripts/ingestWowhead.js --promote        # write src/data/ from Wowhead
 *
 * Data source: the calculator page embeds a data feed URL
 *   https://nether.wowhead.com/data/talents-dragonflight?dv=<n>&db=<n>
 * (the `dv`/`db` data-version params change per patch). We scrape the current URL
 * from the page rather than hardcoding it, so a Wowhead data bump doesn't serve
 * stale data. Override with WOWHEAD_FEED_URL for reproducibility/testing.
 *
 * Class/spec display metadata (names, colours, icons) is chrome, not talent data,
 * and is read from the existing src/data/classes.json index — Wowhead is the
 * source for the TREES; the index is shared. (Re-sourcing the index from Wowhead
 * for a fully standalone fallback is a possible follow-up.)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sanitizeDescription } from "../src/lib/sanitizeDescription.js";
import {
  POINT_BUDGET,
  writeNormalizedData,
  verifyAgainstSnapshot,
  validateClasses,
} from "./lib/ingestCore.js";
import {
  fetchSpellTooltips,
  extractDescription,
} from "./lib/wowheadTooltips.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const TALENT_CALC_URL = "https://www.wowhead.com/talent-calc";

// Wowhead trait grid: cell = posY * GRID_WIDTH + posX. Width 19 reproduces the
// game's (and Icy Veins') exact column/row coordinates — verified node-by-node.
const GRID_WIDTH = 19;

// Wowhead node `type` code → our node type. 1/2 are both single-spell talents
// (square = active/notable, round = passive); 3 is a choice node; 5 is the spec
// apex (multi-rank capstone).
const TYPE_MAP = { 1: "square", 2: "round", 3: "choice", 5: "apex" };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  // descriptions defaults to "follow promote": a verify run doesn't need them
  // (they're a soft field — no effect on schema or the snapshot), so it skips the
  // thousands of tooltip fetches; a promote run includes them. Force either way
  // with --descriptions / --no-descriptions.
  const args = {
    promote: false,
    updateSnapshot: false,
    descriptions: null,
    classSlug: null,
  };
  for (const a of argv) {
    if (a === "--promote" || a === "--write") args.promote = true;
    else if (a === "--update-snapshot") args.updateSnapshot = true;
    else if (a === "--descriptions") args.descriptions = true;
    else if (a === "--no-descriptions") args.descriptions = false;
    else if (a.startsWith("--class="))
      args.classSlug = a.slice("--class=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.descriptions === null) args.descriptions = args.promote;
  return args;
}

// ---------------------------------------------------------------------------
// Feed fetch + parse
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: TALENT_CALC_URL },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/** Find the live talents feed URL embedded in the talent-calc page. */
async function resolveFeedUrl() {
  if (process.env.WOWHEAD_FEED_URL) return process.env.WOWHEAD_FEED_URL;
  const html = await fetchText(TALENT_CALC_URL);
  const m = html.match(
    /https:\/\/nether\.wowhead\.com\/data\/talents-dragonflight\?[^"'&]*(?:&amp;[^"']*)*/,
  );
  if (!m)
    throw new Error("could not find talents feed URL in talent-calc page");
  return m[0].replace(/&amp;/g, "&");
}

/**
 * The feed body is a series of `WH.setPageData("wow.talentCalcDragonflight.live.
 * <key>", <json>)` calls. Extract each JSON argument by scanning matched
 * brackets (string-aware) and parse it. Returns { <key>: parsed }.
 */
function parsePageData(body) {
  const re = /WH\.setPageData\("([^"]+)",/g;
  const out = {};
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].replace("wow.talentCalcDragonflight.live.", "");
    const json = extractBalanced(body, re.lastIndex);
    if (json != null) out[key] = JSON.parse(json);
  }
  return out;
}

/** Slice the balanced [..]/{..} literal beginning at `start` (string-aware). */
function extractBalanced(s, start) {
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const titleCase = (slug) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const cellPos = (cell) => ({
  posX: cell % GRID_WIDTH,
  posY: Math.floor(cell / GRID_WIDTH),
});

/**
 * Normalise one Wowhead talent node into our schema.
 * @param {object} raw       node from a tree's talents[cell]
 * @param {'class'|'spec'|'hero'} treeType
 * @param {string|null} heroSubtree
 * @param {(spellId:number)=>string} descOf  spell id → sanitised HTML description
 */
function normaliseNode(raw, treeType, heroSubtree, descOf) {
  const type = TYPE_MAP[raw.type];
  const { posX, posY } = cellPos(raw.cell);
  const isChoice = type === "choice";

  const base = {
    id: raw.node,
    type,
    treeType,
    posX,
    posY,
    connections: raw.requiresNodes ?? [],
    spentRequired: raw.requiredPoints ?? 0,
    alreadyGranted: false,
  };
  // Every hero-tree node (regular OR choice) must declare its subtree.
  if (heroSubtree != null) base.heroSubtree = heroSubtree;

  if (type === "apex") return normaliseApex(raw, base, descOf);

  if (isChoice) {
    return {
      ...base,
      maxRanks: 1,
      name: null,
      icon: null,
      description: null,
      choices: raw.spells.map((s) => ({
        spellId: s.spell,
        name: s.name,
        icon: s.icon,
        description: descOf(s.spell),
        maxRanks: s.points,
      })),
    };
  }

  const spell = raw.spells[0];
  return {
    ...base,
    maxRanks: spell.points,
    name: spell.name,
    icon: spell.icon,
    description: descOf(spell.spell),
    choices: null,
  };
}

/**
 * The apex (type 5) is encoded as a multi-spell node where the spells are the
 * rank groups. maxRanks is the total points to fully invest (sum of group
 * points), matching the wire layout.
 */
function normaliseApex(raw, base, descOf) {
  return {
    ...base,
    treeType: "spec",
    connections: [],
    maxRanks: raw.spells.reduce((s, sp) => s + sp.points, 0),
    name: raw.spells[0].name,
    icon: raw.spells[0].icon,
    description: null,
    // Per-rank unlock levels are not in this feed; the field is required to be an
    // array but its contents are presentational. (Parity follow-up.)
    levels: [],
    ranks: raw.spells.map((s) => ({
      spellId: s.spell,
      description: descOf(s.spell),
      maxRanks: s.points,
    })),
  };
}

/** All node ids that are real talents anywhere in the class's trees. */
function talentNodeIds(classTree, specTrees, heroTrees) {
  const ids = new Set();
  for (const t of [classTree, ...specTrees, ...heroTrees]) {
    for (const cell of Object.keys(t.talents)) {
      for (const n of t.talents[cell]) ids.add(n.node);
    }
  }
  return ids;
}

/** Hero trees a spec can use: those whose nodes are shownForSpecs that spec. */
function heroTreesForSpec(heroTrees, specId) {
  return heroTrees.filter((t) =>
    Object.values(t.talents)
      .flat()
      .some((n) => (n.shownForSpecs ?? []).includes(specId)),
  );
}

function normaliseSpec(specInfo, ctx, describe) {
  const { classTree, specTree, heroTrees, heroTreeChoices } = ctx;
  // Bind the spec-aware description lookup to this spec's display name, so each
  // node resolves the correct per-spec variant of its tooltip.
  const descOf = (id) => describe(id, specInfo.displayName);
  const specHeroTrees = heroTreesForSpec(heroTrees, specInfo.id);
  const heroIds = new Set(specHeroTrees.map((t) => t.id));

  // The gate node is the heroTreeChoices entry that gates exactly this spec's
  // two hero trees; its value is ordered [left, right].
  const gateEntry = Object.entries(heroTreeChoices).find(
    ([, pair]) =>
      pair.length === heroIds.size && pair.every((id) => heroIds.has(id)),
  );
  const heroGateNodeId = gateEntry ? Number(gateEntry[0]) : null;
  const [leftId, rightId] = gateEntry ? gateEntry[1] : [];
  const treeById = new Map(specHeroTrees.map((t) => [t.id, t]));

  const subtreeOf = (id) => {
    const t = treeById.get(id);
    return t ? { tree: t, name: titleCase(t.slug) } : null;
  };
  const left = subtreeOf(leftId);
  const right = subtreeOf(rightId);

  // Some class/spec nodes are shown only for certain specs (e.g. the per-spec
  // Stance variants of a shared talent). A spec includes only its shown nodes;
  // the rest live in the specs that show them (so the class-wide serialisation
  // set is unchanged). Connections to excluded nodes are dropped, matching how
  // the game routes a shared talent's prerequisite through the active spec.
  const shownHere = (n) => {
    const sf = n.shownForSpecs;
    return !sf || sf.length === 0 || sf.includes(specInfo.id);
  };

  const raw = [];
  for (const cell of Object.keys(classTree.talents))
    for (const n of classTree.talents[cell]) raw.push([n, "class", null]);
  for (const cell of Object.keys(specTree.talents))
    for (const n of specTree.talents[cell]) raw.push([n, "spec", null]);
  for (const side of [left, right]) {
    if (!side) continue;
    for (const cell of Object.keys(side.tree.talents))
      for (const n of side.tree.talents[cell]) raw.push([n, "hero", side.name]);
  }

  const shown = raw.filter(([n]) => shownHere(n));
  const includedIds = new Set(shown.map(([n]) => n.node));
  const nodes = shown.map(([n, treeType, sub]) => {
    const node = normaliseNode(n, treeType, sub, descOf);
    node.connections = node.connections.filter((id) => includedIds.has(id));
    return node;
  });

  const apex = nodes.find((n) => n.type === "apex");
  // Hero budget = spendable nodes per subtree. Each subtree auto-grants its root
  // node (the gate's choice unlocks it for free), so it isn't counted.
  const heroNodeCount = left
    ? Object.values(left.tree.talents).flat().length - 1
    : 0;

  const subtreeMeta = (side, id) =>
    side
      ? {
          name: side.name,
          icon: side.name,
          description: "",
          rootNodeId: heroRootId(side.tree, heroGateNodeId),
        }
      : {
          name: String(id),
          icon: String(id),
          description: "",
          rootNodeId: null,
        };

  return {
    specId: specInfo.id,
    specName: specInfo.displayName,
    specSlug: specInfo.name,
    color: specInfo.color,
    icon: specInfo.icon,
    description: specInfo.description,
    pointBudget: {
      ...POINT_BUDGET,
      spec: POINT_BUDGET.spec + (apex ? apex.maxRanks : 0),
      hero: heroNodeCount, // budget is spendable hero nodes per subtree
    },
    checkpoints: {
      class: normaliseCheckpoints(classTree.checkpoints),
      spec: normaliseCheckpoints(specTree.checkpoints),
    },
    heroGateNodeId,
    heroSubtrees: {
      left: subtreeMeta(left, leftId),
      right: subtreeMeta(right, rightId),
    },
    nodes,
  };
}

/** Hero subtree root: the node the gate's choice unlocks (no in-tree prereq). */
function heroRootId(tree, gateId) {
  const all = Object.values(tree.talents).flat();
  const root = all.find(
    (n) =>
      !(n.requiresNodes ?? []).length ||
      (n.requiresNodes ?? []).includes(gateId),
  );
  return root ? root.node : (all[0]?.node ?? null);
}

function normaliseCheckpoints(raw) {
  // Wowhead ships checkpoints as { row, points }, but its checkpoint row is one
  // ahead of the node grid's 0-indexed rows (the gate divider sits above the row
  // it gates), so shift to match node posY — which is what the gate-checkpoint
  // integrity test asserts.
  return (raw ?? []).map((c) => ({ row: c.row - 1, points: c.points }));
}

// ---------------------------------------------------------------------------
// Build (fetch + normalise, no I/O to src/data) — reused by compareSources.js
// ---------------------------------------------------------------------------

export function loadClassIndex() {
  return JSON.parse(readFileSync(join(DATA_DIR, "classes.json"), "utf8"));
}

/**
 * Fetch the Wowhead feed and normalise the requested classes into the shared
 * schema. Pure of any src/data writes — returns the in-memory dataset.
 *
 * @param {object}   opts
 * @param {object[]} opts.implemented   class index entries to build
 * @param {boolean}  [opts.descriptions] fetch per-spell HTML descriptions
 * @param {boolean}  [opts.quiet]       suppress progress logging
 * @returns {Promise<Record<string, object>>} slug → normalised class data
 */
export async function buildWowheadClasses({
  implemented,
  descriptions = true,
  quiet = false,
}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);

  log("Resolving Wowhead feed URL…");
  const feedUrl = await resolveFeedUrl();
  log(`  ${feedUrl}`);
  log("Fetching talents feed…");
  const feed = parsePageData(await fetchText(feedUrl));
  const trees = feed.trees;
  const nodeMeta = feed.nodes; // per class: { nodes:[ids], heroTreeChoices }

  // Build the description lookup. Descriptions are spec-aware: one spell's
  // tooltip can hold several spec-specific variants, so the right one is picked
  // per spec at normalise time. (spellId, specName) → sanitised HTML.
  let describe = () => "";
  if (descriptions) {
    const spellIds = collectSpellIds(trees, implemented);
    log(`Fetching ${spellIds.length} spell tooltips (cached)…`);
    const tooltips = await fetchSpellTooltips(spellIds);
    describe = (id, specName) =>
      sanitizeDescription(extractDescription(tooltips.get(id) ?? "", specName));
  } else {
    log("Skipping descriptions.");
  }

  const classes = {};
  for (const cls of implemented) {
    const whTrees = trees.filter((t) => t.playerClass === cls.id);
    const specIds = new Set(cls.specs.map((s) => s.id));
    const heroTrees = whTrees.filter((t) => t.slug);
    const specTrees = whTrees.filter((t) => specIds.has(t.id));
    const classTree = whTrees.find((t) => !t.slug && !specIds.has(t.id));
    if (!classTree) {
      console.warn(`no class tree found for ${cls.displayName}`);
      continue;
    }
    const meta = nodeMeta[String(cls.id)] ?? { nodes: [], heroTreeChoices: {} };
    const heroTreeChoices = meta.heroTreeChoices ?? {};

    const specs = {};
    for (const specInfo of cls.specs) {
      const specTree = specTrees.find((t) => t.id === specInfo.id);
      if (!specTree) {
        console.warn(`  no spec tree for ${cls.displayName}/${specInfo.name}`);
        continue;
      }
      specs[specInfo.name] = normaliseSpec(
        specInfo,
        { classTree, specTree, heroTrees, heroTreeChoices },
        describe,
      );
    }

    // Class-level placeholder ids: in the serialisation space but not talents and
    // not the hero gates (gates are modelled via heroGateNodeId).
    const talents = talentNodeIds(classTree, specTrees, heroTrees);
    const gateIds = new Set(Object.keys(heroTreeChoices).map(Number));
    const unusedNodeIds = (meta.nodes ?? []).filter(
      (id) => !talents.has(id) && !gateIds.has(id),
    );

    classes[cls.name] = {
      classId: cls.id,
      className: cls.displayName,
      classSlug: cls.name,
      color: cls.color,
      icon: cls.icon,
      unusedNodeIds,
      specs,
    };
    log(`  normalised ${cls.displayName}`);
  }

  return classes;
}

// ---------------------------------------------------------------------------
// Main (CLI)
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const classIndex = loadClassIndex();
  let implemented = classIndex.filter((c) => c.implemented);
  if (args.classSlug) {
    implemented = implemented.filter((c) => c.name === args.classSlug);
    if (implemented.length === 0)
      throw new Error(`no implemented class named "${args.classSlug}"`);
  }

  const classes = await buildWowheadClasses({
    implemented,
    descriptions: args.descriptions,
  });

  // Verify mode (default): schema-validate + fingerprint + snapshot diff, write
  // nothing. This is the cross-validation / fallback-readiness check.
  if (!args.promote) {
    console.log("\n── Verify (no files written) ──");

    const { totalProblems, byClass } = validateClasses(classIndex, classes);
    for (const [slug, problems] of Object.entries(byClass)) {
      if (problems.length) {
        console.log(`  ✗ schema  ${slug}: ${problems.length} problem(s)`);
        for (const p of problems) console.log(`        - ${p}`);
      }
    }

    const { allMatch, results } = verifyAgainstSnapshot(classes);
    for (const r of results) {
      const tag = r.match ? "✓ match" : "✗ DIVERGES";
      const detail = r.match
        ? `count ${r.got.count}`
        : `expected ${r.expected ? `${r.expected.count}/${r.expected.hash}` : "(none)"} got ${r.got.count}/${r.got.hash}`;
      console.log(`  ${tag}  ${r.slug.padEnd(14)} ${detail}`);
    }

    const ok = allMatch && totalProblems === 0;
    console.log(
      ok
        ? "\n✓ Schema valid and build-string-compatible with the committed snapshot."
        : `\n✗ ${totalProblems} schema problem(s); snapshot ${allMatch ? "matches" : "diverges"} — Wowhead mapping needs work.`,
    );
    process.exit(ok ? 0 : 1);
  }

  // Promote: Wowhead becomes the writer.
  console.log("\n── Promote (writing src/data/) ──");
  const { validationFailures } = writeNormalizedData({
    classIndex,
    classes,
    updateSnapshot: args.updateSnapshot,
  });
  if (validationFailures > 0) process.exit(1);
  console.log("\nDone.");
}

/** Every spell id referenced by the trees of the given classes. */
function collectSpellIds(trees, classes) {
  const classIds = new Set(classes.map((c) => c.id));
  const ids = new Set();
  for (const t of trees) {
    if (!classIds.has(t.playerClass)) continue;
    for (const cell of Object.keys(t.talents)) {
      for (const n of t.talents[cell]) {
        for (const s of n.spells) if (s.spell) ids.add(s.spell);
      }
    }
  }
  return [...ids];
}

// Run only when invoked directly, not when imported (e.g. by compareSources.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
