import { describe, it, expect } from "vitest";
import { sha256Hex } from "./sha256";

/**
 * The fallback runs wherever crypto.subtle does not — a LAN or Tailscale
 * address over plain HTTP, which is exactly where this page gets previewed. If
 * it disagreed with WebCrypto by one byte the page would show a confident,
 * wrong fingerprint, which is worse than showing none.
 */
const subtle = globalThis.crypto.subtle;
const withoutWebCrypto = async (fn: () => Promise<string>) => {
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
  try { return await fn(); } finally {
    Object.defineProperty(globalThis.crypto, "subtle", { value: subtle, configurable: true });
  }
};

/** FIPS 180-4 published digests. */
const VECTORS: Array<[string, string]> = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
];

describe("sha256Hex", () => {
  it.each(VECTORS)("matches the published digest for %o", async (input, expected) => {
    await expect(sha256Hex(input)).resolves.toBe(expected);
  });

  it("falls back when crypto.subtle is missing, as it is on plain-HTTP origins", async () => {
    const fallback = await withoutWebCrypto(() => sha256Hex("abc"));
    expect(fallback).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("agrees with WebCrypto on multi-block and multi-byte input", async () => {
    for (const text of ["x".repeat(1000), "Dispatch: café — naïve 😀", "a\nb\nc"]) {
      expect(await withoutWebCrypto(() => sha256Hex(text))).toBe(await sha256Hex(text));
    }
  });
});
