import { expect, test } from "vitest";
import { sha256Hex } from "./sha256";

test("matches the published SHA-256 test vector", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("changes completely when one character changes", async () => {
  expect(await sha256Hex("Okay.")).not.toBe(await sha256Hex("Okay!"));
});
