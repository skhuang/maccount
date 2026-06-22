import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../src/crypto";

describe("crypto (AES-GCM secret-at-rest)", () => {
  it("round-trips a secret", async () => {
    const ct = await encryptSecret("1//refresh-token-value", "key-1");
    expect(ct).not.toContain("refresh-token-value");
    expect(await decryptSecret(ct, "key-1")).toBe("1//refresh-token-value");
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const a = await encryptSecret("same", "key-1");
    const b = await encryptSecret("same", "key-1");
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, "key-1")).toBe("same");
    expect(await decryptSecret(b, "key-1")).toBe("same");
  });

  it("fails to decrypt with the wrong key", async () => {
    const ct = await encryptSecret("secret", "key-1");
    await expect(decryptSecret(ct, "key-2")).rejects.toBeTruthy();
  });
});
