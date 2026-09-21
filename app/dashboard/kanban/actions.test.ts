import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUser, profileSingle, upsertPipelineItem, captionQueueAdd, triggerQueueDrain, storageUpload, revalidatePath } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    profileSingle: vi.fn(),
    upsertPipelineItem: vi.fn(),
    captionQueueAdd: vi.fn(),
    triggerQueueDrain: vi.fn(),
    storageUpload: vi.fn(),
    revalidatePath: vi.fn(),
  }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({ storage: { from: () => ({ upload: storageUpload }) } }),
}));
vi.mock("@/lib/ingestion/pipeline-items", () => ({ upsertPipelineItem }));
vi.mock("@/workers/queues", () => ({ captionQueue: { add: captionQueueAdd } }));
vi.mock("@/lib/queue/trigger", () => ({ triggerQueueDrain }));
// assertPublicHttpsUrl faz uma resolução de DNS de verdade — mockado aqui
// pelo mesmo motivo do app/api/n8n/webhook/route.test.ts (não depender de
// rede/DNS real nos testes). Comportamento real coberto em
// lib/http/url-safety.test.ts.
vi.mock("@/lib/http/url-safety", () => ({
  assertPublicHttpsUrl: async (value: string) => {
    const { hostname, protocol } = new URL(value);
    if (protocol !== "https:") throw new Error("URL precisa ser https");
    if (hostname === "127.0.0.1" || hostname.startsWith("169.254.")) {
      throw new Error(`URL aponta para um endereço privado/reservado (${hostname})`);
    }
  },
}));

import { createManualPipelineItemAction } from "./actions";

function makeFormData(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("createManualPipelineItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "editor@puzzlerecords.com" } } });
    profileSingle.mockResolvedValue({ data: { role: "equipe_conteudo" }, error: null });
    global.fetch = vi.fn();
  });

  it("rejeita usuário não autenticado", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(
      createManualPipelineItemAction(
        { error: null, success: false },
        makeFormData({ title: "t", mediaUrl: "https://cdn.example.com/a.jpg" }),
      ),
    ).rejects.toThrow("não autenticado");
  });

  it("rejeita papel sem acesso ao Kanban", async () => {
    profileSingle.mockResolvedValue({ data: { role: null }, error: null });

    await expect(
      createManualPipelineItemAction(
        { error: null, success: false },
        makeFormData({ title: "t", mediaUrl: "https://cdn.example.com/a.jpg" }),
      ),
    ).rejects.toThrow("acesso restrito");
  });

  it("retorna erro quando título está vazio", async () => {
    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData({ title: "", mediaUrl: "https://cdn.example.com/a.jpg" }),
    );
    expect(result.error).toMatch(/título/);
    expect(result.success).toBe(false);
  });

  it("retorna erro quando mediaUrl está vazia", async () => {
    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData({ title: "t", mediaUrl: "" }),
    );
    expect(result.error).toMatch(/URL/);
  });

  it("rejeita mediaUrl apontando para IP privado (SSRF)", async () => {
    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData({ title: "t", mediaUrl: "https://127.0.0.1/a.jpg" }),
    );
    expect(result.error).toMatch(/privado|reservado/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cria o item, sobe a mídia e enfileira a legenda quando tudo é válido", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "recebido" });

    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData({ title: "Show da Fresno", mediaUrl: "https://cdn.example.com/a.jpg" }),
    );

    expect(result).toEqual({ error: null, success: true });
    expect(upsertPipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "manual", title: "Show da Fresno", author: "editor@puzzlerecords.com" }),
    );
    expect(captionQueueAdd).toHaveBeenCalledWith("caption", { pipelineItemId: "item-1" });
    expect(triggerQueueDrain).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/kanban");
  });

  it("não enfileira legenda quando o upsert retorna um status posterior a 'recebido'", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "legenda" });

    await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData({ title: "t", mediaUrl: "https://cdn.example.com/a.jpg" }),
    );

    expect(captionQueueAdd).not.toHaveBeenCalled();
  });
});
