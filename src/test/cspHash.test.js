import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Guards the one fragile, hand-maintained link in the security config: the inline
// anti-flash theme script in index.html is allowlisted in the production CSP
// (public/.htaccess) by its sha256 hash. Editing the script without recomputing
// the hash silently blocks it in production — reintroducing the theme flash — and
// nothing else in the gate would notice. This turns that into a loud test failure.

const repoFile = (rel) =>
  fileURLToPath(new URL(`../../${rel}`, import.meta.url));

describe("CSP inline-script hash", () => {
  test("the .htaccess sha256 matches index.html's inline script", () => {
    const html = readFileSync(repoFile("index.html"), "utf8");
    // The inline script is the only <script> with no attributes; the app entry is
    // <script type="module" src=…>, which this literal-tag regex won't match.
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(match, "expected an inline <script> in index.html").not.toBeNull();

    const computed = createHash("sha256").update(match[1]).digest("base64");

    const htaccess = readFileSync(repoFile("public/.htaccess"), "utf8");
    const declared = htaccess.match(/'sha256-([A-Za-z0-9+/=]+)'/);
    expect(declared, "expected a sha256-… in the .htaccess CSP").not.toBeNull();

    expect(declared[1]).toBe(computed);
  });
});
