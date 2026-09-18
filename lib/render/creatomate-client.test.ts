import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCreatomateRender } from "./creatomate-client";

describe("startCreatomateRender — parsing da resposta real da API v2", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.CREATOMATE_API_KEY = "test-key";
    process.env.CREATOMATE_TEMPLATE_ID = "test-template";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("lê um objeto único (formato real confirmado na API v2, não um array)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "r1", status: "planned", url: null, template_id: "test-template" }),
    }) as unknown as typeof fetch;

    const render = await startCreatomateRender({}, "https://example.com/webhook");

    expect(render).toEqual({ id: "r1", status: "planned", url: null, template_id: "test-template" });
  });

  it("continua aceitando um array (formato defensivo, ex.: v1 legado)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "r2", status: "planned", url: null }],
    }) as unknown as typeof fetch;

    const render = await startCreatomateRender({}, "https://example.com/webhook");

    expect(render.id).toBe("r2");
  });

  it("lança erro claro quando a resposta não tem id de render", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(startCreatomateRender({}, "https://example.com/webhook")).rejects.toThrow(
      "Creatomate não retornou nenhum render na resposta",
    );
  });
});
