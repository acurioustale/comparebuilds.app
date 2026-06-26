import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_BUILDS,
  MAX_BUILD_LEN,
  MAX_BUILD_NAME_LEN,
} from "./buildsStore.js";

// The client mirrors the share API's limits so it can reject bad input early with
// a nicer message, but api/share.php is the authority. Both files carry a "keep in
// sync" comment; this test makes the mirror enforce itself across the two
// languages, so a change to one side that forgets the other fails the gate.

const sharePhp = readFileSync(
  fileURLToPath(new URL("../../api/share.php", import.meta.url)),
  "utf8",
);

const phpConst = (name) => {
  const m = sharePhp.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`could not find PHP const ${name} in share.php`);
  return Number(m[1]);
};

describe("client/server share-limit parity", () => {
  test("MAX_BUILDS matches share.php", () => {
    expect(MAX_BUILDS).toBe(phpConst("MAX_BUILDS"));
  });

  test("MAX_BUILD_LEN matches share.php", () => {
    expect(MAX_BUILD_LEN).toBe(phpConst("MAX_BUILD_LEN"));
  });

  test("MAX_BUILD_NAME_LEN matches share.php MAX_LABEL_LEN", () => {
    expect(MAX_BUILD_NAME_LEN).toBe(phpConst("MAX_LABEL_LEN"));
  });
});
