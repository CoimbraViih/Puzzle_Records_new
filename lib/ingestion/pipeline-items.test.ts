import { describe, it, expect } from "vitest";
import { buildPipelineItemPayload } from "./pipeline-items";

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
