const SAO_PAULO_TZ = "America/Sao_Paulo";

/**
 * O Zernio retorna horários em UTC (ver PRD §3) — toda exibição de
 * calendário/agendamento precisa passar por aqui antes de chegar na tela.
 */
export function formatUtcAsSaoPaulo(isoUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoUtc));
}

export function utcToSaoPauloParts(isoUtc: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(isoUtc)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
