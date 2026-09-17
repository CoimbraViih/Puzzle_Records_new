import { describe, it, expect } from "vitest";
import { isRelevantDriveChange } from "./google-drive";

describe("isRelevantDriveChange", () => {
  it("aceita arquivo cujo pai é a pasta observada e não é papelera", () => {
    const relevant = isRelevantDriveChange(
      {
        fileId: "f1",
        removed: false,
        file: { id: "f1", parents: ["FOLDER_ID"], trashed: false, mimeType: "image/jpeg" },
      },
      "FOLDER_ID",
    );
    expect(relevant).toBe(true);
  });

  it("ignora arquivo que não é imagem/vídeo (pasta, Google Doc, etc.)", () => {
    const relevant = isRelevantDriveChange(
      {
        fileId: "f1",
        removed: false,
        file: {
          id: "f1",
          parents: ["FOLDER_ID"],
          trashed: false,
          mimeType: "application/vnd.google-apps.folder",
        },
      },
      "FOLDER_ID",
    );
    expect(relevant).toBe(false);
  });

  it("ignora mudança de arquivo removido/na lixeira", () => {
    const relevant = isRelevantDriveChange(
      { fileId: "f1", removed: true },
      "FOLDER_ID",
    );
    expect(relevant).toBe(false);
  });

  it("ignora arquivo de outra pasta", () => {
    const relevant = isRelevantDriveChange(
      {
        fileId: "f1",
        removed: false,
        file: { id: "f1", parents: ["OUTRA_PASTA"], trashed: false, mimeType: "image/jpeg" },
      },
      "FOLDER_ID",
    );
    expect(relevant).toBe(false);
  });
});
