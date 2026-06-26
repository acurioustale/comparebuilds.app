/**
 * compareSources.js
 * -----------------
 * Cross-validates the Wowhead source against the committed dataset (Icy Veins'
 * current output in src/data/). This is the "prove the two sources agree" and
 * "fallback-readiness" check: if Wowhead can reproduce the same talent trees,
 * we can switch to it when Icy Veins is behind or down.
 *
 * It normalises Wowhead in memory (reusing ingestWowhead's mapper) and diffs it
 * node-by-node against src/data/, separating:
 *   - HARD divergences — build-string / correctness fields that MUST agree:
 *     the per-class wire-layout fingerprint, and for nodes present in both: their
 *     maxRanks, choice arity, gate threshold (spentRequired), and prerequisite
 *     connections (restricted to shared nodes); plus per spec the hero gate node
 *     id. Any of these failing exits non-zero.
 *   - SOFT divergences — fields that legitimately differ between sources without
 *     affecting build strings: per-spec membership (a node one source shows and
 *     the other treats as unused or shows under a different spec), positions,
 *     names, descriptions, budgets, checkpoints. Reported, never fail the run.
 *
 * Run:
 *   node scripts/compareSources.js                  # all classes, no descriptions
 *   node scripts/compareSources.js --class=warrior  # one class
 *   node scripts/compareSources.js --descriptions   # also diff description text (soft)
 *
 * Network-dependent (fetches Wowhead live), so this is intentionally NOT part of
 * the validate gate — see .github/workflows/sources.yml.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { wireLayout } from "../src/lib/wireLayout.js";
import { loadClassIndex, buildWowheadClasses } from "./ingestWowhead.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

function parseArgs(argv) {
  const args = { classSlug: null, descriptions: false };
  for (const a of argv) {
    if (a === "--descriptions") args.descriptions = true;
    else if (a.startsWith("--class="))
      args.classSlug = a.slice("--class=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

// Compare as a set: order and duplicates are insignificant for connections.
// (Icy Veins sometimes lists a prerequisite more than once.)
const sortedIds = (arr) =>
  [...new Set((arr ?? []).map(Number))].sort((a, b) => a - b);

/** Compare one class's Wowhead data against its committed (Icy Veins) data. */
function diffClass(slug, wh, iv, opts) {
  const hard = [];
  const soft = [];

  // Wire-layout fingerprint — the build-string compatibility gate.
  const whWire = wireLayout(wh);
  const ivWire = wireLayout(iv);
  if (whWire.hash !== ivWire.hash) {
    hard.push(
      `wire layout differs (count ${ivWire.count}→${whWire.count}, hash ${ivWire.hash}→${whWire.hash})`,
    );
  }

  for (const specSlug of Object.keys(iv.specs)) {
    const ivSpec = iv.specs[specSlug];
    const whSpec = wh.specs[specSlug];
    const at = (kind, msg) =>
      (kind === "hard" ? hard : soft).push(`${specSlug}: ${msg}`);
    if (!whSpec) {
      hard.push(`${specSlug}: missing from Wowhead`);
      continue;
    }

    if (whSpec.heroGateNodeId !== ivSpec.heroGateNodeId)
      at(
        "hard",
        `heroGateNodeId ${ivSpec.heroGateNodeId}→${whSpec.heroGateNodeId}`,
      );

    const ivNodes = new Map(ivSpec.nodes.map((n) => [n.id, n]));
    const whNodes = new Map(whSpec.nodes.map((n) => [n.id, n]));

    // Per-spec MEMBERSHIP can differ without breaking build strings — the wire
    // layout (a class-wide set) is unchanged, the node just displays under a
    // different spec, or one source treats it as an unused placeholder. The
    // hash check above is the build-string gate; membership is informational.
    const onlyIv = [...ivNodes.keys()].filter((id) => !whNodes.has(id));
    const onlyWh = [...whNodes.keys()].filter((id) => !ivNodes.has(id));
    if (onlyIv.length || onlyWh.length)
      at(
        "soft",
        `membership: ${onlyIv.length} IV-only, ${onlyWh.length} Wowhead-only`,
      );

    let pos = 0,
      name = 0,
      desc = 0;
    for (const [id, ivn] of ivNodes) {
      const whn = whNodes.get(id);
      if (!whn) continue; // membership-only, reported above
      if (ivn.maxRanks !== whn.maxRanks)
        at("hard", `node ${id} maxRanks ${ivn.maxRanks}→${whn.maxRanks}`);
      if ((ivn.choices?.length ?? 0) !== (whn.choices?.length ?? 0))
        at("hard", `node ${id} choice arity differs`);
      if (ivn.spentRequired !== whn.spentRequired)
        at("hard", `node ${id} gate ${ivn.spentRequired}→${whn.spentRequired}`);
      // Compare only edges to nodes present in BOTH specs, so a membership
      // difference doesn't masquerade as miswiring — a genuine prerequisite
      // change between shared nodes still trips here.
      const common = (conns) =>
        sortedIds(conns).filter((c) => ivNodes.has(c) && whNodes.has(c));
      if (common(ivn.connections).join() !== common(whn.connections).join())
        at("hard", `node ${id} connections differ`);
      if (ivn.posX !== whn.posX || ivn.posY !== whn.posY) pos++;
      if (ivn.name !== whn.name) name++;
      if (opts.descriptions && ivn.description !== whn.description) desc++;
    }
    if (pos) at("soft", `${pos} node position(s) differ`);
    if (name) at("soft", `${name} node name(s) differ`);
    if (desc) at("soft", `${desc} node description(s) differ`);

    // Checkpoints (visual gate ladder) — soft.
    if (
      JSON.stringify(ivSpec.checkpoints) !== JSON.stringify(whSpec.checkpoints)
    )
      at("soft", "checkpoints differ");
    if (
      JSON.stringify(ivSpec.pointBudget) !== JSON.stringify(whSpec.pointBudget)
    )
      at("soft", "pointBudget differs");
  }

  return { hard, soft };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const classIndex = loadClassIndex();
  let implemented = classIndex.filter((c) => c.implemented);
  if (args.classSlug)
    implemented = implemented.filter((c) => c.name === args.classSlug);

  const whClasses = await buildWowheadClasses({
    implemented,
    descriptions: args.descriptions,
  });

  console.log("\n── Wowhead vs committed (Icy Veins) ──");
  let hardTotal = 0;
  let softTotal = 0;
  for (const cls of implemented) {
    const wh = whClasses[cls.name];
    if (!wh) {
      console.log(`  ✗ ${cls.name}: not produced by Wowhead`);
      hardTotal++;
      continue;
    }
    const iv = JSON.parse(
      readFileSync(join(DATA_DIR, `${cls.name}.json`), "utf8"),
    );
    const { hard, soft } = diffClass(cls.name, wh, iv, args);
    hardTotal += hard.length;
    softTotal += soft.length;

    const tag = hard.length === 0 ? "✓" : "✗";
    console.log(
      `  ${tag} ${cls.name.padEnd(14)} ${hard.length} hard, ${soft.length} soft`,
    );
    for (const h of hard) console.log(`      HARD  ${h}`);
    for (const s of soft) console.log(`      soft  ${s}`);
  }

  console.log(
    `\n${hardTotal === 0 ? "✓" : "✗"} ${hardTotal} hard divergence(s), ${softTotal} soft (informational).`,
  );
  process.exit(hardTotal === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
