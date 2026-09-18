import { listApiKeys } from "@/lib/api-keys/api-keys";

export type IntegrationKey = "drive" | "telegram" | "openrouter" | "creatomate" | "zernio" | "n8n";
export type ConnectionStatus = "connected" | "not_configured";

function hasAllEnv(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]));
}

const ENV_REQUIREMENTS: Record<Exclude<IntegrationKey, "n8n">, string[]> = {
  drive: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_DRIVE_FOLDER_ID"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_CHAT_IDS"],
  openrouter: ["OPENROUTER_API_KEY"],
  creatomate: ["CREATOMATE_API_KEY", "CREATOMATE_TEMPLATE_ID"],
  zernio: ["ZERNIO_API_KEY", "ZERNIO_INSTAGRAM_ACCOUNT_ID"],
};

/**
 * n8n não tem credencial de saída (env var) — o Puzzle Records é quem expõe
 * o webhook para o n8n chamar. "Conectado" aqui significa "existe pelo menos
 * uma API key ativa para autenticar essa chamada", não uma checagem de rede.
 */
export async function getConnectionStatus(key: IntegrationKey): Promise<ConnectionStatus> {
  if (key === "n8n") {
    const keys = await listApiKeys();
    return keys.some((k) => !k.revoked_at) ? "connected" : "not_configured";
  }
  return hasAllEnv(ENV_REQUIREMENTS[key]) ? "connected" : "not_configured";
}

export type TestableIntegrationKey = Exclude<IntegrationKey, "n8n">;

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

async function testDrive(): Promise<ConnectionTestResult> {
  const { getDriveClient } = await import("@/lib/ingestion/google-drive");
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) return { ok: false, message: "GOOGLE_DRIVE_FOLDER_ID não configurado." };
  const drive = getDriveClient();
  const response = await drive.files.get({ fileId: folderId, fields: "id, name", supportsAllDrives: true });
  return { ok: true, message: `Pasta encontrada: ${response.data.name ?? response.data.id}` };
}

async function testTelegram(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const { Bot } = await import("grammy");
  const bot = new Bot(requireEnv("TELEGRAM_BOT_TOKEN"));
  const me = await bot.api.getMe();
  return { ok: true, message: `Bot conectado: @${me.username}` };
}

async function testOpenRouter(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `OpenRouter respondeu ${response.status}` };
  return { ok: true, message: "Chave válida no OpenRouter." };
}

async function testCreatomate(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const templateId = requireEnv("CREATOMATE_TEMPLATE_ID");
  const response = await fetch(`https://api.creatomate.com/v2/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${requireEnv("CREATOMATE_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `Creatomate respondeu ${response.status}` };
  return { ok: true, message: "Template encontrado no Creatomate." };
}

async function testZernio(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const baseUrl = process.env.ZERNIO_API_BASE_URL || "https://zernio.com/api";
  const response = await fetch(`${baseUrl}/v1/accounts`, {
    headers: { Authorization: `Bearer ${requireEnv("ZERNIO_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `Zernio respondeu ${response.status}` };
  return { ok: true, message: "Conta(s) encontrada(s) no Zernio." };
}

const TEST_FUNCTIONS: Record<TestableIntegrationKey, () => Promise<ConnectionTestResult>> = {
  drive: testDrive,
  telegram: testTelegram,
  openrouter: testOpenRouter,
  creatomate: testCreatomate,
  zernio: testZernio,
};

export async function testConnection(key: TestableIntegrationKey): Promise<ConnectionTestResult> {
  try {
    return await TEST_FUNCTIONS[key]();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[connections] teste de conexão falhou para ${key}:`, message);
    return { ok: false, message };
  }
}
