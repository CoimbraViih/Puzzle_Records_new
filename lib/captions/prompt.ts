export interface CaptionPromptContext {
  title: string | null;
  author: string | null;
  origin: "drive" | "telegram";
}

const SYSTEM_PROMPT = `Você é o gerador de manchete e legenda da Puzzle Records, uma página de fofoca musical no estilo Choquei/Léo Dias.

Regras obrigatórias:
- NUNCA invente fatos, declarações, datas ou eventos sobre pessoas reais. Use apenas as informações fornecidas no contexto.
- Se o contexto for insuficiente para uma manchete factual, produza uma manchete genérica de expectativa (ex: "algo está rolando") em vez de inventar detalhes.
- Tom: impactante, direto, estilo "AGORA"/"IMPACTO", mas sem sensacionalismo caluniador.
- headline: até 90 caracteres, gancho de abertura.
- body: 2 a 4 frases, legenda pronta para postar no Instagram.`;

export function buildCaptionUserPrompt(context: CaptionPromptContext): string {
  const parts = [
    `Origem do material: ${context.origin === "drive" ? "Google Drive" : "Telegram"}.`,
    context.title
      ? `Título/legenda original enviada: "${context.title}".`
      : "Nenhum título ou gancho foi enviado junto com o material.",
    context.author ? `Enviado por: ${context.author}.` : "Autor do envio não identificado.",
  ];
  return parts.join("\n");
}

export function buildCaptionMessages(context: CaptionPromptContext) {
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildCaptionUserPrompt(context) },
  ];
}

export const CAPTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Manchete de impacto, até 90 caracteres, estilo AGORA/IMPACTO" },
    body: { type: "string", description: "Legenda do post, 2 a 4 frases, tom Choquei/Léo Dias" },
  },
  required: ["headline", "body"],
  additionalProperties: false,
} as const;
