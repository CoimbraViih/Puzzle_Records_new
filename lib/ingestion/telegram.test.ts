import { describe, it, expect } from "vitest";
import { extractMediaFromMessage } from "./telegram";

describe("extractMediaFromMessage", () => {
  it("extrai a maior foto de uma mensagem com array de tamanhos", () => {
    const media = extractMediaFromMessage({
      caption: "gancho aqui",
      photo: [
        { file_id: "small", file_unique_id: "u-small", width: 90, height: 90 },
        { file_id: "big", file_unique_id: "u-big", width: 1280, height: 1280 },
      ],
    } as never);

    expect(media).toEqual({ fileId: "big", fileUniqueId: "u-big", mimeType: "image/jpeg", caption: "gancho aqui" });
  });

  it("extrai vídeo", () => {
    const media = extractMediaFromMessage({
      caption: null,
      video: { file_id: "v1", file_unique_id: "u-v1", mime_type: "video/mp4" },
    } as never);

    expect(media).toEqual({ fileId: "v1", fileUniqueId: "u-v1", mimeType: "video/mp4", caption: null });
  });

  it("retorna null quando não há mídia suportada", () => {
    const media = extractMediaFromMessage({ text: "oi" } as never);
    expect(media).toBeNull();
  });
});
