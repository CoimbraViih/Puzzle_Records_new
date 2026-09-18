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

export default async function ConfiguracoesPage() {
  const [connectionStatuses, apiKeys] = await Promise.all([
    Promise.all(INTEGRATIONS.map(async (i) => [i.key, await getConnectionStatus(i.key)] as const)),
    listApiKeys(),
  ]);
  const n8nStatus = await getConnectionStatus("n8n");
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
        <div className="mt-4">
          <ApiKeysSection keys={apiKeys} webhookUrl={webhookUrl} />
        </div>
      </section>
    </div>
  );
}
