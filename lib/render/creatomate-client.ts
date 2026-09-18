import { requireEnv } from "@/lib/ingestion/cron-auth";

const CREATOMATE_API_BASE = "https://api.creatomate.com/v2";

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

  // A API v2 do Creatomate retorna um único objeto quando o request é um
  // único template_id (não um array — v1 retornava array; confirmado batendo
  // na API real com uma chave válida). Mantemos suporte defensivo ao formato
  // de array também, caso a API alguma vez responda em lote.
  const payload = (await response.json()) as CreatomateRenderResult | CreatomateRenderResult[];
  const render = Array.isArray(payload) ? payload[0] : payload;
  if (!render || !render.id) throw new Error("Creatomate não retornou nenhum render na resposta");
  return render;
}
