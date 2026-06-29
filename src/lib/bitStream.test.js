import { describe, test, expect } from "vitest";
import { BitReader, BitWriter } from "./bitStream.js";

describe("bitStream safe shift handling", () => {
  test("BitReader.readBits throws RangeError for count > 53", () => {
    const reader = new BitReader("AAAAAAAA");
    expect(() => reader.readBits(54)).toThrow(RangeError);
  });

  test("BitWriter.writeBits throws RangeError for count > 31 with non-zero value", () => {
    const writer = new BitWriter();
    expect(() => writer.writeBits(1, 32)).toThrow(RangeError);
  });

  test("BitWriter.writeBits succeeds for count > 31 when value is 0", () => {
    const writer = new BitWriter();
    expect(() => writer.writeBits(0, 128)).not.toThrow();
  });
});
