/**
 * scripts/lib/blizzardApi.js
 * --------------------------
 * Thin client for Blizzard's World of Warcraft Game Data API — the authoritative
 * upstream that both Icy Veins and Wowhead copy from. Used only by the build-time
 * ingest (scripts/ingestBlizzard.js); never imported by the browser app.
 *
 * Auth is OAuth2 client-credentials: POST the client id/secret to the OAuth
 * endpoint for a bearer token (valid ~24h), then send it on every Game Data
 * request along with the required `static-{region}` namespace.
 *
 * Credentials (see .env.example) are resolved, in precedence order, from:
 *   1. a file named by BLIZZARD_CREDENTIALS_FILE (may live ANYWHERE — e.g. above
 *      the repo, the config.php analog for keeping secrets off the tree),
 *   2. a gitignored `.env` in the repo root,
 *   3. the process environment (CI sets BLIZZARD_CLIENT_ID/SECRET as secrets).
 * Nothing here is ever committed or deployed: scripts/ is build-time only.
 *
 * GET responses are cached on disk (scripts/.cache/blizzard/, gitignored) so
 * repeated verify runs are fast and stay well under the rate limit. Delete the
 * cache dir to force a refetch (e.g. after a game patch).
 *
 * Node-only (fs + global fetch). No external dependencies.
 */

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CACHE_DIR = join(__dirname, "..", ".cache", "blizzard");

// ---------------------------------------------------------------------------
// Credential loading
// ---------------------------------------------------------------------------

/** Parse simple KEY=VALUE lines (ignoring blanks and `#` comments). */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Resolve credentials from the layered sources without clobbering anything the
 * caller already exported. Returns { clientId, clientSecret, region }.
 */
export function loadCredentials(env = process.env) {
  const fromFiles = {};
  // Lowest precedence first so later sources override earlier ones.
  const candidates = [
    join(REPO_ROOT, ".env"),
    env.BLIZZARD_CREDENTIALS_FILE
      ? resolve(REPO_ROOT, env.BLIZZARD_CREDENTIALS_FILE)
      : null,
  ].filter(Boolean);
  for (const path of candidates) {
    if (existsSync(path))
      Object.assign(fromFiles, parseEnv(readFileSync(path, "utf8")));
  }

  const pick = (key) => env[key] ?? fromFiles[key];
  const clientId = pick("BLIZZARD_CLIENT_ID");
  const clientSecret = pick("BLIZZARD_CLIENT_SECRET");
  const region = (pick("BLIZZARD_REGION") || "us").toLowerCase();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Blizzard API credentials. Set BLIZZARD_CLIENT_ID and " +
        "BLIZZARD_CLIENT_SECRET in a gitignored .env (see .env.example), in a " +
        "file named by BLIZZARD_CREDENTIALS_FILE, or in the environment.",
    );
  }
  return { clientId, clientSecret, region };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const OAUTH_HOST = "https://oauth.battle.net/token";
const apiHost = (region) => `https://${region}.api.blizzard.com`;

export class BlizzardApi {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.cache=true]  read/write the on-disk GET cache
   * @param {string}  [opts.locale="en_US"]
   */
  constructor({ cache = true, locale = "en_US" } = {}) {
    const { clientId, clientSecret, region } = loadCredentials();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.region = region;
    this.namespace = `static-${region}`;
    this.locale = locale;
    this.useCache = cache;
    this._token = null;
    if (cache) mkdirSync(CACHE_DIR, { recursive: true });
  }

  async token() {
    if (this._token) return this._token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(OAUTH_HOST, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`OAuth token request failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    this._token = json.access_token;
    return this._token;
  }

  /**
   * GET a Game Data resource. `path` is the API path (e.g.
   * "/data/wow/talent-tree/index"); namespace + locale are added automatically.
   * Absolute hrefs returned by the API are also accepted (their namespace is
   * normalised to the version-pinned one Blizzard hands back).
   *
   * @param {string} path
   * @param {Record<string,string|number>} [params]  extra query params
   * @returns {Promise<object>}
   */
  async get(path, params = {}) {
    const url = this._url(path, params);
    const cacheFile = this._cachePath(url);
    if (this.useCache && cacheFile && existsSync(cacheFile)) {
      return JSON.parse(readFileSync(cacheFile, "utf8"));
    }
    const token = await this.token();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const json = await res.json();
    if (this.useCache && cacheFile) {
      writeFileSync(cacheFile, JSON.stringify(json), "utf8");
    }
    return json;
  }

  _url(path, params) {
    const u = path.startsWith("http")
      ? new URL(path)
      : new URL(path, apiHost(this.region));
    u.searchParams.set("namespace", this.namespace);
    u.searchParams.set("locale", this.locale);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  _cachePath(url) {
    if (!this.useCache) return null;
    // Hash without the (volatile, version-pinned) namespace so cache keys are
    // stable across the patch bumps Blizzard injects into returned hrefs.
    const key = url.replace(/([?&])namespace=[^&]*/, "");
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
    return join(CACHE_DIR, `${hash}.json`);
  }

  /**
   * The exact client build the API is currently serving, in wago.tools form
   * (e.g. "12.0.7.67808"). Read from the version-pinned namespace Blizzard echoes
   * back in any response href (`static-12.0.7_67808-us`). Used to pin the DB2
   * pull to the same build the tree data came from.
   */
  async resolvedBuild() {
    if (this._build) return this._build;
    const idx = await this.get("/data/wow/talent-tree/index");
    const href = idx?._links?.self?.href ?? "";
    const m = href.match(new RegExp(`static-(.+?)-${this.region}\\b`));
    this._build = m ? m[1].replace("_", ".") : null;
    return this._build;
  }
}

/** Convenience: a spell's icon NAME (basename, no extension) via the Media API. */
export async function fetchIconName(api, spellId) {
  const media = await api.get(`/data/wow/media/spell/${spellId}`);
  const icon = (media.assets ?? []).find((a) => a.key === "icon");
  if (!icon) return null;
  const m = icon.value.match(/\/([^/]+)\.(?:jpg|png)$/i);
  return m ? m[1] : null;
}

/**
 * A spell's rendered tooltip description (raw HTML/text, NOT yet sanitised) via
 * the Spell API. Works for any spell id, including the apex capstone's extra-rank
 * spells that the talent-tree endpoint omits.
 */
export async function fetchSpellDescription(api, spellId) {
  const spell = await api.get(`/data/wow/spell/${spellId}`);
  return spell?.description ?? "";
}

/** True if the on-disk cache currently holds anything (diagnostics only). */
export function cachePopulated() {
  return existsSync(CACHE_DIR) && readdirSync(CACHE_DIR).length > 0;
}
