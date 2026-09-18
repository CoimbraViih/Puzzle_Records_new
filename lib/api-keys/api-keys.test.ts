import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./api-keys";

describe("generateApiKey", () => {
  it("gera uma chave com o prefixo pzr_ e um hash SHA-256 consistente", () => {
    const generated = generateApiKey();

    expect(generated.plaintext.startsWith("pzr_")).toBe(true);
    expect(generated.hash).toHaveLength(64); // sha256 em hex
    expect(generated.hash).toBe(hashApiKey(generated.plaintext));
    expect(generated.prefix).toBe(generated.plaintext.slice(0, 10));
  });

  it("gera chaves diferentes a cada chamada", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("hashApiKey", () => {
  it("é determinístico para a mesma entrada", () => {
    expect(hashApiKey("pzr_abc")).toBe(hashApiKey("pzr_abc"));
  });

  it("produz hashes diferentes para entradas diferentes", () => {
    expect(hashApiKey("pzr_abc")).not.toBe(hashApiKey("pzr_abd"));
  });
});
