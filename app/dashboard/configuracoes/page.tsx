import { getConnectionStatus, type TestableIntegrationKey } from "@/lib/connections/status";
import { listApiKeys } from "@/lib/api-keys/api-keys";
import { ConnectionCard } from "./connection-card";
import { ApiKeysSection } from "./api-keys-section";

export const dynamic = "force-dynamic";

const INTEGRATIONS: { key: TestableIntegrationKey; title: string; description: string }[] = [
  { key: "drive", title: "Google Drive", description: "Ingestão de material bruto via pasta observada." },
  { key: "telegram", title: "Telegram", description: "Bot para upload rápido de material bruto." },
  { key: "openrouter", title: "OpenRouter", description: "Geração de legenda/manchete por IA." },
  { key: "creatomate", title: "Creatomate", description: "Render de vídeo por template." },
  { key: "zernio", title: "Zernio", description: "Publicação/agendamento no Instagram e analytics." },
];

/**
 * A tabela api_keys (migration 00000000000004) precisa ser aplicada
 * manualmente em produção — mesmo padrão das migrations 1-3 deste projeto.
 * Até lá, listApiKeys() e getConnectionStatus("n8n") (que também consulta
 * api_keys) falham com um erro de relação inexistente. Isso não pode
 * derrubar a página inteira: os 5 cards de Conexões baseados em env var
 * (Drive/Telegram/OpenRouter/Creatomate/Zernio) não dependem dessa tabela.
 */
async function safeListApiKeys(): Promise<{ keys: Awaited<ReturnType<typeof listApiKeys>>; unavailable: boolean }> {
  try {
    return { keys: await listApiKeys(), unavailable: false };
  } catch (error) {
    console.error("[configuracoes] falha ao listar api_keys (migration 4 aplicada?):", error);
    return { keys: [], unavailable: true };
  }
}

async function safeGetN8nStatus() {
  try {
    return await getConnectionStatus("n8n");
  } catch (error) {
    console.error("[configuracoes] falha ao obter status do n8n (migration 4 aplicada?):", error);
    return "not_configured" as const;
  }
}

export default async function ConfiguracoesPage() {
  const [connectionStatuses, { keys: apiKeys, unavailable: apiKeysUnavailable }, n8nStatus] = await Promise.all([
    Promise.all(INTEGRATIONS.map(async (i) => [i.key, await getConnectionStatus(i.key)] as const)),
    safeListApiKeys(),
    safeGetN8nStatus(),
  ]);
  const statusMap = Object.fromEntries(connectionStatuses);

  const webhookUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/api/n8n/webhook`;

  return (
    <div className="space-y-8 p-6">
      <section>
        <h1 className="text-lg font-semibold">Conexões</h1>
        <p className="text-sm text-muted-foreground">
          Status das integrações externas. Credenciais são configuradas via variáveis de ambiente (Vercel) — esta
          tela reflete o estado atual e permite testar a conectividade.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((integration) => (
            <ConnectionCard
              key={integration.key}
              integrationKey={integration.key}
              title={integration.title}
              description={integration.description}
              status={statusMap[integration.key]}
            />
          ))}
          <ConnectionCard
            integrationKey="n8n"
            title="n8n"
            description="Webhook de ingestão para automações externas — não tem teste de conectividade (é o n8n quem chama o Puzzle Records)."
            status={n8nStatus}
            testable={false}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">API Keys</h2>
        {apiKeysUnavailable && (
          <p className="mt-2 text-sm text-destructive">
            Tabela api_keys indisponível — aplique a migration 00000000000004 antes de usar esta seção.
          </p>
        )}
        <div className="mt-4">
          <ApiKeysSection keys={apiKeys} webhookUrl={webhookUrl} />
        </div>
      </section>
    </div>
  );
}
