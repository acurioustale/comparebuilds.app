import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { resolveRoute, specIdForPath } from "./route.js";

describe("resolveRoute", () => {
  test("a 6-char alphanumeric hash is a server short-link", () => {
    assert.deepStrictEqual(resolveRoute({ hash: "#aB3xZ9" }), {
      kind: "server-share",
      id: "aB3xZ9",
    });
  });

  test("a #b= hash is a client-side instant link", () => {
    assert.deepStrictEqual(resolveRoute({ hash: "#b=SOMETOKEN" }), {
      kind: "client-share",
      token: "SOMETOKEN",
    });
  });

  test("an empty client token still resolves as client-share (decode rejects it later)", () => {
    assert.deepStrictEqual(resolveRoute({ hash: "#b=" }), {
      kind: "client-share",
      token: "",
    });
  });

  test("no hash is a local restore", () => {
    assert.deepStrictEqual(resolveRoute({ hash: "" }), { kind: "local" });
  });

  test("an unrecognised hash falls back to local", () => {
    assert.deepStrictEqual(resolveRoute({ hash: "#something-else" }), {
      kind: "local",
    });
    // A 5- or 7-char hash is not a valid share id.
    assert.deepStrictEqual(resolveRoute({ hash: "#abcde" }), { kind: "local" });
    assert.deepStrictEqual(resolveRoute({ hash: "#abcdefg" }), {
      kind: "local",
    });
  });

  test("a /<class>/<spec> path resolves to that spec", () => {
    // death_knight/blood → specId 250 (with or without a trailing slash).
    assert.deepStrictEqual(
      resolveRoute({ hash: "", pathname: "/death-knight/blood" }),
      { kind: "spec-page", specId: 250 },
    );
    assert.deepStrictEqual(
      resolveRoute({ hash: "", pathname: "/death-knight/blood/" }),
      { kind: "spec-page", specId: 250 },
    );
  });

  test("a share hash beats a spec path", () => {
    assert.deepStrictEqual(
      resolveRoute({ hash: "#aB3xZ9", pathname: "/death-knight/blood" }),
      { kind: "server-share", id: "aB3xZ9" },
    );
  });

  test("an unknown path is local", () => {
    assert.deepStrictEqual(
      resolveRoute({ hash: "", pathname: "/not/a-spec" }),
      { kind: "local" },
    );
    assert.deepStrictEqual(resolveRoute({ hash: "", pathname: "/" }), {
      kind: "local",
    });
  });
});

describe("specIdForPath", () => {
  test("maps known class/spec segments to a spec id", () => {
    assert.strictEqual(specIdForPath("/death-knight/blood/"), 250);
    assert.strictEqual(specIdForPath("death-knight/blood"), 250);
  });
  test("returns null for unknown or malformed paths", () => {
    assert.strictEqual(specIdForPath("/death-knight"), null);
    assert.strictEqual(specIdForPath("/nope/nope"), null);
    assert.strictEqual(specIdForPath(""), null);
  });
  test("is case-insensitive on the pathname", () => {
    assert.strictEqual(specIdForPath("/Death-Knight/Blood"), 250);
    assert.strictEqual(specIdForPath("/DEATH-KNIGHT/BLOOD/"), 250);
  });
});
