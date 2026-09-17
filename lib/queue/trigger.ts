/**
 * Dispara o drain da fila imediatamente após um enqueue, sem esperar o
 * próximo tick do cron (que roda a cada 5 min). Nunca lança erro nem
 * bloqueia quem chamou — o cron cobre o retry se essa chamada falhar.
 */
export function triggerQueueDrain(): void {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!baseUrl || !secret) return;

  fetch(`${baseUrl}/api/queue/process`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch((err) => {
    console.error("[queue] falha ao disparar drain imediato (cron cobre o retry):", err);
  });
}
