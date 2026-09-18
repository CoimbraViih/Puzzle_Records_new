import { after } from "next/server";

/**
 * Dispara o drain da fila imediatamente após um enqueue, sem esperar o
 * próximo tick do cron (que roda a cada 5 min). Nunca lança erro nem
 * bloqueia quem chamou — o cron cobre o retry se essa chamada falhar.
 *
 * O fetch roda dentro de `after()` (Next 15+) em vez de fire-and-forget: sem
 * isso a Vercel congela a instância assim que a resposta é enviada e o
 * request pode nunca sair. Todos os call sites estão dentro do ciclo de vida
 * de um route handler (webhooks de ingestão, webhook do Creatomate, e os
 * processors, que só rodam dentro de `/api/queue/process`). Fora desse
 * contexto `after()` lança — nesse caso caímos no fetch best-effort antigo.
 */
export function triggerQueueDrain(): void {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!baseUrl || !secret) return;

  const drain = async () => {
    try {
      await fetch(`${baseUrl}/api/queue/process`, {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
    } catch (err) {
      console.error("[queue] falha ao disparar drain imediato (cron cobre o retry):", err);
    }
  };

  try {
    after(drain);
  } catch (err) {
    console.error("[queue] after() indisponível neste contexto — usando fetch best-effort:", err);
    void drain();
  }
}
