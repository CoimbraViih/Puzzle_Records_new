import { requireEnv } from "@/lib/ingestion/cron-auth";

const CREATOMATE_API_BASE = "https://api.creatomate.com/v1";

export interface CreatomateRenderResult {
  id: string;
  status: string;
  url: string | null;
}

export async function startCreatomateRender(
  modifications: Record<string, string>,
  webhookUrl: string,
): Promise<CreatomateRenderResult> {
  const apiKey = requireEnv("CREATOMATE_API_KEY");
  const templateId = requireEnv("CREATOMATE_TEMPLATE_ID");

  const response = await fetch(`${CREATOMATE_API_BASE}/renders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      modifications,
      webhook_url: webhookUrl,
    }),
  });

  if (!response.ok) {
    // O corpo bruto fica só no log do servidor: ele pode ecoar o payload
    // enviado (inclusive o webhook_url, que carrega o token do webhook) e a
    // mensagem do erro vai parar em render_error, exibido no Kanban para
    // qualquer usuário de equipe_conteudo.
    const body = await response.text();
    console.error(`[creatomate] render request falhou (${response.status}):`, body);
    throw new Error(`Creatomate render falhou com status ${response.status}`);
  }

  const payload = (await response.json()) as CreatomateRenderResult[];
  const render = payload[0];
  if (!render) throw new Error("Creatomate não retornou nenhum render na resposta");
  return render;
}
