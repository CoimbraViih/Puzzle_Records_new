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

import { createManualPipelineItemAction } from "./actions";

function makeFormData(file: File | null) {
  const formData = new FormData();
  if (file) formData.set("file", file);
  return formData;
}

function makeFile(bytes: number, type = "video/mp4", name = "clipe.mp4") {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("createManualPipelineItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "editor@puzzlerecords.com" } } });
    profileSingle.mockResolvedValue({ data: { role: "equipe_conteudo" }, error: null });
  });

  it("rejeita usuário não autenticado", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(
      createManualPipelineItemAction({ error: null, success: false }, makeFormData(makeFile(10))),
    ).rejects.toThrow("não autenticado");
  });

  it("rejeita papel sem acesso ao Kanban", async () => {
    profileSingle.mockResolvedValue({ data: { role: null }, error: null });

    await expect(
      createManualPipelineItemAction({ error: null, success: false }, makeFormData(makeFile(10))),
    ).rejects.toThrow("acesso restrito");
  });

  it("retorna erro quando nenhum arquivo é enviado", async () => {
    const result = await createManualPipelineItemAction({ error: null, success: false }, makeFormData(null));
    expect(result.error).toMatch(/arquivo/i);
    expect(result.success).toBe(false);
  });

  it("retorna erro quando o arquivo excede 50MB", async () => {
    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData(makeFile(51 * 1024 * 1024)),
    );
    expect(result.error).toMatch(/50MB/);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("cria o item, sobe a mídia e enfileira a legenda quando tudo é válido", async () => {
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "recebido" });

    const result = await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData(makeFile(1024, "video/mp4")),
    );

    expect(result).toEqual({ error: null, success: true });
    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^manual\/.+\.mp4$/),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "video/mp4" }),
    );
    expect(upsertPipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "manual", title: null, author: "editor@puzzlerecords.com" }),
    );
    expect(captionQueueAdd).toHaveBeenCalledWith("caption", { pipelineItemId: "item-1" });
    expect(triggerQueueDrain).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/kanban");
  });

  it("aceita foto (image/jpeg) e usa a extensão correta", async () => {
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-2", status: "recebido" });

    await createManualPipelineItemAction(
      { error: null, success: false },
      makeFormData(makeFile(1024, "image/jpeg", "foto.jpg")),
    );

    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^manual\/.+\.jpg$/),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("retorna erro quando o upload para o storage falha", async () => {
    storageUpload.mockResolvedValue({ error: { message: "bucket indisponível" } });

    const result = await createManualPipelineItemAction({ error: null, success: false }, makeFormData(makeFile(1024)));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bucket indisponível/);
    expect(upsertPipelineItem).not.toHaveBeenCalled();
  });

  it("não enfileira legenda quando o upsert retorna um status posterior a 'recebido'", async () => {
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", status: "legenda" });

    await createManualPipelineItemAction({ error: null, success: false }, makeFormData(makeFile(1024)));

    expect(captionQueueAdd).not.toHaveBeenCalled();
  });
});
