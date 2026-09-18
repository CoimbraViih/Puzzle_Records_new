import type { VercelConfig } from "@vercel/config/v1";

// Plano Vercel Hobby: máximo 2 cron jobs no total, nenhum mais frequente que
// 1x/dia (confirmado ao tentar deployar com 3 crons de 5 em 5 minutos — a
// Vercel rejeitou o deploy). `/api/cron/daily` consolida o poll de segurança
// do Drive (Fase 1) e o drain da fila (Fase 2/3/5) numa única invocação
// diária. Ver pendência #7 do `.docs/PLAN.md` e o comentário em
// app/api/cron/daily/route.ts para o caminho de volta aos 5 minutos no plano Pro.
export const config: VercelConfig = {
  crons: [
    { path: "/api/drive/renew-channel", schedule: "0 3 * * *" },
    { path: "/api/cron/daily", schedule: "0 4 * * *" },
  ],
};
