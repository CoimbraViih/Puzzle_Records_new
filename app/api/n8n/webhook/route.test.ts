// app/api/n8n/webhook/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { verifyApiKey, upsertPipelineItem, captionQueueAdd, triggerQueueDrain, storageUpload } = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  upsertPipelineItem: vi.fn(),
  captionQueueAdd: vi.fn(),
  triggerQueueDrain: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock("@/lib/api-keys/api-keys", () => ({ verifyApiKey }));
vi.mock("@/lib/ingestion/pipeline-items", () => ({ upsertPipelineItem }));
vi.mock("@/workers/queues", () => ({ captionQueue: { add: captionQueueAdd } }));
vi.mock("@/lib/queue/trigger", () => ({ triggerQueueDrain }));
// assertPublicHttpsUrl faz uma resolução de DNS de verdade — mockado para os
// testes não dependerem de rede/DNS disponível (CI, sandbox offline, etc.).
// O comportamento real de rejeitar IP privado é coberto pelos testes de
// lib/http/url-safety.test.ts.
vi.mock("@/lib/http/url-safety", () => ({
  assertPublicHttpsUrl: async (value: string) => {
    if (new URL(value).protocol !== "https:") throw new Error("URL precisa ser https");
  },
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    storage: { from: () => ({ upload: storageUpload }) },
  }),
}));

// Evita bater na rede de verdade nos testes que nem deveriam chegar ao fetch
// (as pastas de auth/validação abaixo retornam antes disso).
global.fetch = vi.fn();

import { POST } from "./route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/n8n/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/n8n/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem header Authorization", async () => {
    const response = await POST(makeRequest({ externalId: "x", mediaUrl: "https://x.com/a.jpg" }));
    expect(response.status).toBe(401);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("retorna 401 quando a API key é inválida ou revogada", async () => {
    verifyApiKey.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ externalId: "x", mediaUrl: "https://x.com/a.jpg" }, { authorization: "Bearer pzr_invalida" }),
    );
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando externalId ou mediaUrl estão ausentes", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    const response = await POST(makeRequest({ externalId: "x" }, { authorization: "Bearer pzr_valida" }));
    expect(response.status).toBe(400);
  });

  it("retorna 400 quando mediaUrl não é https", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    const response = await POST(
      makeRequest({ externalId: "x", mediaUrl: "http://inseguro.com/a.jpg" }, { authorization: "Bearer pzr_valida" }),
    );
    expect(response.status).toBe(400);
  });

  it("retorna 400 quando externalId contém caracteres inválidos (ex.: path traversal)", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    const response = await POST(
      makeRequest(
        { externalId: "../../etc/passwd", mediaUrl: "https://cdn.n8n.io/a.jpg" },
        { authorization: "Bearer pzr_valida" },
      ),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/externalId inválido/);
  });

  it("cria o pipeline_item e enfileira a legenda quando tudo é válido", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "recebido" });

    const response = await POST(
      makeRequest(
        { externalId: "x", mediaUrl: "https://cdn.n8n.io/a.jpg", mimeType: "image/jpeg", title: "Gancho", author: "fluxo-x" },
        { authorization: "Bearer pzr_valida" },
      ),
    );

    expect(response.status).toBe(200);
    expect(upsertPipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "n8n", externalId: "x", storagePath: "n8n/x.jpg" }),
    );
    expect(captionQueueAdd).toHaveBeenCalledWith("caption", { pipelineItemId: "item-1" });
    expect(triggerQueueDrain).toHaveBeenCalled();
  });

  it("não reenfileira a legenda quando o item já existia em uma etapa posterior (webhook duplicado/corrida com o polling)", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "legenda" });

    const response = await POST(
      makeRequest(
        { externalId: "x", mediaUrl: "https://cdn.n8n.io/a.jpg", mimeType: "image/jpeg" },
        { authorization: "Bearer pzr_valida" },
      ),
    );

    expect(response.status).toBe(200);
    expect(captionQueueAdd).not.toHaveBeenCalled();
    expect(triggerQueueDrain).not.toHaveBeenCalled();
  });

  it("retorna 500 com JSON estruturado (sem lançar) quando upsertPipelineItem falha após o upload", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockRejectedValue(new Error("relation \"api_keys\" does not exist"));

    const response = await POST(
      makeRequest(
        { externalId: "x", mediaUrl: "https://cdn.n8n.io/a.jpg", mimeType: "image/jpeg" },
        { authorization: "Bearer pzr_valida" },
      ),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(captionQueueAdd).not.toHaveBeenCalled();
    expect(triggerQueueDrain).not.toHaveBeenCalled();
  });
});
