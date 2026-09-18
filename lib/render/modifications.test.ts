import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCreatomateModifications } from "./modifications";

describe("buildCreatomateModifications", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.CREATOMATE_LAYER_HEADLINE = "Headline";
    process.env.CREATOMATE_LAYER_PHOTO_1 = "Photo-1";
    process.env.CREATOMATE_LAYER_PHOTO_2 = "Photo-2";
    process.env.CREATOMATE_LAYER_BADGE = "Badge";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("mapeia headline, foto 1 e badge para os nomes de camada configurados", () => {
    const modifications = buildCreatomateModifications(
      { headline: "ELE VOLTOU!", body: "legenda" },
      { photo1Url: "https://example.com/foto1.jpg" },
    );
    expect(modifications).toEqual({
      Headline: "ELE VOLTOU!",
      "Photo-1": "https://example.com/foto1.jpg",
      "Photo-2": "https://example.com/foto1.jpg", // sem segunda foto disponível -> reusa a primeira
      Badge: "AGORA",
    });
  });

  it("usa a segunda foto quando fornecida", () => {
    const modifications = buildCreatomateModifications(
      { headline: "x", body: "y" },
      { photo1Url: "https://example.com/1.jpg", photo2Url: "https://example.com/2.jpg" },
    );
    expect(modifications["Photo-2"]).toBe("https://example.com/2.jpg");
  });

  it("omite camadas cujo nome não está configurado via env", () => {
    delete process.env.CREATOMATE_LAYER_BADGE;
    const modifications = buildCreatomateModifications({ headline: "x", body: "y" }, { photo1Url: "https://example.com/1.jpg" });
    expect(modifications).not.toHaveProperty("Badge");
  });
});
