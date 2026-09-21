import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertSelect = vi.fn();
const singleSelect = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      upsert: () => ({ select: () => upsertSelect() }),
      select: () => ({ eq: () => ({ eq: () => ({ single: singleSelect }) }) }),
    }),
  }),
}));

import { buildPipelineItemPayload, upsertPipelineItem, progressPercentFor } from "./pipeline-items";

describe("buildPipelineItemPayload", () => {
  it("monta o payload de um item vindo do Drive", () => {
    const payload = buildPipelineItemPayload({
      origin: "drive",
      externalId: "1AbcDriveFileId",
      title: "foto-gancho.jpg",
      author: "editor@puzzlerecords.com",
      mimeType: "image/jpeg",
      driveFileId: "1AbcDriveFileId",
      metadata: { webViewLink: "https://drive.google.com/file/d/1AbcDriveFileId" },
    });

    expect(payload).toEqual({
      origin: "drive",
      external_id: "1AbcDriveFileId",
      status: "recebido",
      title: "foto-gancho.jpg",
      author: "editor@puzzlerecords.com",
      mime_type: "image/jpeg",
      drive_file_id: "1AbcDriveFileId",
      storage_path: null,
      metadata: { webViewLink: "https://drive.google.com/file/d/1AbcDriveFileId" },
    });
  });

  it("monta o payload de um item vindo do Telegram, com storage_path", () => {
    const payload = buildPipelineItemPayload({
      origin: "telegram",
      externalId: "AgADtelegram123",
      title: "Envio de @joaocontent",
      author: "@joaocontent",
      mimeType: "video/mp4",
      storagePath: "telegram/AgADtelegram123.mp4",
      metadata: { caption: "surtou de novo" },
    });

    expect(payload.origin).toBe("telegram");
    expect(payload.storage_path).toBe("telegram/AgADtelegram123.mp4");
    expect(payload.drive_file_id).toBeNull();
  });

  it("monta o payload de um item vindo do n8n", () => {
    const payload = buildPipelineItemPayload({
      origin: "n8n",
      externalId: "n8n-run-42",
      title: "Gancho vindo do n8n",
      author: "workflow: captação-automatica",
      mimeType: "image/jpeg",
      storagePath: "n8n/n8n-run-42.jpg",
      metadata: { apiKeyId: "11111111-1111-1111-1111-111111111111" },
    });

    expect(payload.origin).toBe("n8n");
    expect(payload.storage_path).toBe("n8n/n8n-run-42.jpg");
    expect(payload.drive_file_id).toBeNull();
  });
});

describe("upsertPipelineItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna o status atual mesmo quando a linha já existia (não sobrescrita pelo upsert)", async () => {
    // ignoreDuplicates faz o upsert não retornar a linha quando já existe.
    upsertSelect.mockResolvedValue({ data: null, error: null });
    // A linha já tinha avançado para "legenda" antes deste upsert duplicado
    // (ex.: webhook e polling processando o mesmo arquivo).
    singleSelect.mockResolvedValue({ data: { id: "item-1", status: "legenda" }, error: null });

    const result = await upsertPipelineItem({
      origin: "drive",
      externalId: "f1",
      title: "t",
      author: "a",
      mimeType: "image/jpeg",
    });

    // Crítico: o chamador (polling/webhook) decide se reenfileira com base
    // neste status, não em "a linha já existia" — ver comentário na função.
    expect(result).toEqual({ id: "item-1", status: "legenda" });
  });

  it("retorna status 'recebido' para uma linha recém-inserida", async () => {
    upsertSelect.mockResolvedValue({ data: [{ id: "item-2" }], error: null });
    singleSelect.mockResolvedValue({ data: { id: "item-2", status: "recebido" }, error: null });

    const result = await upsertPipelineItem({
      origin: "telegram",
      externalId: "t1",
      title: "t",
      author: "a",
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({ id: "item-2", status: "recebido" });
  });
});

describe("progressPercentFor", () => {
  it("mapeia cada status para seu percentual na ordem do pipeline", () => {
    expect(progressPercentFor("recebido")).toBe(0);
    expect(progressPercentFor("legenda")).toBe(20);
    expect(progressPercentFor("renderizando")).toBe(40);
    expect(progressPercentFor("aguardando_aprovacao")).toBe(60);
    expect(progressPercentFor("agendado")).toBe(80);
    expect(progressPercentFor("publicado")).toBe(100);
  });

  it("retorna 0 para um status desconhecido em vez de lançar", () => {
    expect(progressPercentFor("status-inexistente")).toBe(0);
  });
});
