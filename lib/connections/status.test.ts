import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api-keys/api-keys", () => ({ listApiKeys: vi.fn() }));

import { listApiKeys } from "@/lib/api-keys/api-keys";
import { getConnectionStatus } from "./status";

const ORIGINAL_ENV = { ...process.env };

describe("getConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("retorna not_configured quando falta alguma env var do Drive", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    expect(await getConnectionStatus("drive")).toBe("not_configured");
  });

  it("retorna connected quando todas as env vars do Drive existem", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "svc@example.com";
    process.env.GOOGLE_PRIVATE_KEY = "chave";
    process.env.GOOGLE_DRIVE_FOLDER_ID = "folder-1";
    expect(await getConnectionStatus("drive")).toBe("connected");
  });

  it("retorna connected para n8n quando existe ao menos 1 API key não revogada", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([
      { id: "1", name: "n8n", key_prefix: "pzr_ab", created_at: "now", last_used_at: null, revoked_at: null },
    ]);
    expect(await getConnectionStatus("n8n")).toBe("connected");
  });

  it("retorna not_configured para n8n quando todas as chaves estão revogadas", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([
      { id: "1", name: "n8n", key_prefix: "pzr_ab", created_at: "now", last_used_at: null, revoked_at: "now" },
    ]);
    expect(await getConnectionStatus("n8n")).toBe("not_configured");
  });
});
