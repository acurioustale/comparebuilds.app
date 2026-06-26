/**
 * scripts/lib/wowheadTooltips.js
 * ------------------------------
 * Fetches per-spell tooltip HTML from Wowhead, because the talent-calc feed ships
 * empty `description` fields. Used by ingestWowhead.js to give the Wowhead source
 * real, current descriptions (Wowhead is often fresher than Icy Veins — the
 * fallback exists precisely for when Icy Veins is behind).
 *
 * Two parts:
 *   - fetchSpellTooltips(): downloads the raw tooltip HTML per spell, cached on
 *     disk incrementally (like scripts/fetchIcons.js). We cache the RAW html, not
 *     an extracted string, so the spec-aware extraction below can be re-run (and
 *     improved) without re-fetching thousands of spells.
 *   - extractDescription(): pulls the clean effect text for a given spec out of
 *     that html. Wowhead talents commonly carry SEVERAL spec-specific variants in
 *     one tooltip, each introduced by a coloured spec label; we select the
 *     variant for the spec being ingested. The result is sanitised by the caller
 *     (sanitizeDescription) before it lands in src/data/.
 *
 * Node-only.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", ".cache");
const CACHE_PATH = join(CACHE_DIR, "wowhead-tooltips.json");

const TOOLTIP_URL = (id) =>
  `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`;
const CONCURRENCY = 8;

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
}

/**
 * @param {number[]} spellIds
 * @returns {Promise<Map<number,string>>}  spell id → raw tooltip HTML
 */
export async function fetchSpellTooltips(spellIds) {
  const cache = loadCache();
  const missing = spellIds.filter((id) => cache[String(id)] === undefined);

  let cursor = 0;
  let fetched = 0;
  const failures = [];

  async function worker() {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      try {
        const res = await fetch(TOOLTIP_URL(id), {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        cache[String(id)] =
          typeof json?.tooltip === "string" ? json.tooltip : "";
        fetched++;
      } catch (err) {
        failures.push(`${id} (${err.message})`);
        cache[String(id)] = ""; // cache the miss so we don't hammer it next run
      }
      if (cursor % 200 === 0) {
        console.log(`  …${cursor}/${missing.length} tooltips`);
        saveCache(cache);
      }
    }
  }

  if (missing.length) {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    saveCache(cache);
    console.log(
      `  fetched ${fetched}, ${spellIds.length - missing.length} cached`,
    );
    if (failures.length)
      console.warn(`  ${failures.length} tooltip fetch failure(s)`);
  }

  const map = new Map();
  for (const id of spellIds) map.set(id, cache[String(id)] ?? "");
  return map;
}

// ── Extraction ────────────────────────────────────────────────────────────────

// The effect text is the `<div class="q">` of the body table (the header table
// holds the spell name, the "Talent" label as `<div class="q0">`, and the level
// requirement). Grab the first exact-class "q" div's inner html.
function effectHtml(tooltip) {
  if (!tooltip) return "";
  const m = tooltip.match(/<div class="q">([\s\S]*?)<\/div>/);
  if (m) return m[1];
  // Fallback: body after the header table, comments/markers stripped later.
  const afterHeader = tooltip.split(/<\/table>/);
  return afterHeader.length > 1
    ? afterHeader.slice(1).join("</table>")
    : tooltip;
}

// Many talents pack per-spec variants into one tooltip, each introduced by a
// coloured spec label span listing one or more spec names, e.g.
//   <span class="q2"> Arms</span><br />…arms text…
//   <span class="q2"> Fury, Protection</span><br />…fury/prot text…
// Split into { specs:[name…]|null, html } segments; a single segment with
// specs=null means the description is the same for every spec.
function splitVariants(html) {
  const cleaned = html
    // Wowhead wraps blocks in `<!--spNNN:M-->…<!--spNNN-->`. Some are embedded
    // tooltips of REFERENCED spells (to drop); others wrap the talent's own
    // effect or a conditional variant (to keep — only their markers go). An
    // embedded spell tooltip is recognisable by a spell link or a nested table;
    // keep the inner content otherwise.
    // (Only non-zero ids — `sp0:0…sp0` always wraps this spell's own effect.)
    .replace(
      /<!--sp([1-9]\d*):\d+-->([\s\S]*?)<!--sp\1-->/g,
      (_, _id, inner) =>
        /href=["']?[^"'>]*spell=|<table/i.test(inner) ? "" : inner,
    )
    // Remaining standalone markers.
    .replace(/<!--[\s\S]*?-->/g, "")
    // Some referenced sub-tooltips render as a nested <table> appended after the
    // effect text (e.g. a spell this talent upgrades into). Drop those.
    .replace(/<table>[\s\S]*?<\/table>/g, "")
    // Some referenced sub-tooltips have no markers — they render as an inline
    // icon, the spell name, then a <br /> and the spell's full text in an <a>.
    // Drop that whole appended block (a spec-variant label is a q2 span whose
    // icon is NOT followed by an <a>, so it is left intact here).
    .replace(
      /<span class=["']tooltip-inside-icon["'][^>]*>\s*<\/span>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?(?:<br\s*\/?>\s*)?<a [^>]*>[\s\S]*?<\/a>/g,
      "",
    )
    // Spec-label icon spans (so the q2 label text is clean to read).
    .replace(/<span class=["']tooltip-inside-icon["'][^>]*>\s*<\/span>/g, "");

  // Per-spec variant labels are q2 spans (the green spec-header colour) that
  // introduce a block — i.e. immediately followed by a <br />. q2 is also used
  // inline inside `[Spec: …]` conditionals (followed by ":" or text), which are
  // NOT variant boundaries; the <br /> lookahead excludes those. Inline spell-name
  // links use other quality classes (q9 etc.) and never match here.
  const re = /<span class=["']q2["']>([\s\S]*?)<\/span>\s*(?=<br\s*\/?>)/g;
  const labels = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    labels.push({
      end: re.lastIndex,
      start: m.index,
      names: m[1]
        .replace(/<[^>]+>/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  if (labels.length === 0) return [{ specs: null, html: cleaned }];

  return labels.map((l, i) => ({
    specs: l.names,
    html: cleaned.slice(
      l.end,
      i + 1 < labels.length ? labels[i + 1].start : undefined,
    ),
  }));
}

function tidy(html) {
  // Break token: after tags are stripped, the only valid markup is <br />, so we
  // hold breaks aside to remove stray angle brackets, then restore them.
  const BR = "\u0001";
  return (
    html
      // A run of 3+ line breaks separates the effect from an appended referenced
      // sub-tooltip (real paragraph breaks are double); cut there to the end.
      .replace(/(?:<br\s*\/?>\s*){3,}[\s\S]*$/i, "")
      // Strip anchor and span tags independently of their partners, keeping inner
      // text — Wowhead sometimes nests/unbalances <a> inside spell references, so
      // pair-matching would leave stray </a>.
      .replace(/<\/?a\b[^>]*>/g, "") // spell links → their text
      .replace(/<\/?span[^>]*>/g, "") // residual colour/quality span wrappers
      .replace(/<\/?(?:table|tbody|tr|td|th)\b[^>]*>/g, "") // stray sub-tooltip table fragments
      // Hold real line breaks aside, then drop any remaining angle bracket — it is
      // a stray text artifact, not markup (Wowhead occasionally emits a lone `>`
      // in a damage formula, e.g. "(190% of Spell Power)> * 24"; genuine "<"/">"
      // in text arrive escaped). Restore the breaks afterwards.
      .replace(/<br\s*\/?>/gi, BR)
      .replace(/[<>]/g, "")
      .replace(new RegExp(BR, "g"), "<br />")
      .replace(/^\s*(?:<br\s*\/?>\s*)+/i, "") // leading breaks (after a stripped label)
      .replace(/(?:\s*<br\s*\/?>)+\s*$/i, "") // trailing breaks
      .trim()
  );
}
/**
 * Clean effect description for `specName` from a raw tooltip. Selects the spec's
 * variant when the tooltip carries several; returns "" when there's nothing
 * usable. The output is HTML (still to be passed through sanitizeDescription).
 *
 * @param {string} tooltip   raw tooltip HTML (from fetchSpellTooltips)
 * @param {string} specName  the spec's display name, e.g. "Arms"
 */
export function extractDescription(tooltip, specName) {
  const variants = splitVariants(effectHtml(tooltip));
  if (variants.length === 1 && variants[0].specs === null)
    return tidy(variants[0].html);
  const match = variants.find((v) =>
    v.specs.some((s) => s.toLowerCase() === specName.toLowerCase()),
  );
  return tidy((match ?? variants[0]).html);
}
