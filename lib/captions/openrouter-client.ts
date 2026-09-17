import { OpenRouter } from "@openrouter/sdk";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { buildCaptionMessages, CAPTION_JSON_SCHEMA, type CaptionPromptContext } from "./prompt";

export type CaptionContext = CaptionPromptContext;

export interface GeneratedCaption {
  headline: string;
  body: string;
}

export async function requestCaptionFromOpenRouter(context: CaptionContext): Promise<GeneratedCaption> {
  const client = new OpenRouter({ apiKey: requireEnv("OPENROUTER_API_KEY") });
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";

  const result = await client.chat.send({
    chatRequest: {
      model,
      messages: buildCaptionMessages(context),
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "puzzle_records_caption", strict: true, schema: CAPTION_JSON_SCHEMA },
      },
      temperature: 0.7,
    },
  });

  if (!("choices" in result)) {
    throw new Error("OpenRouter retornou um stream inesperado (esperava resposta não-streaming)");
  }

  const content = result.choices[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter não retornou conteúdo de texto na resposta");
  }

  const parsed = JSON.parse(content) as Partial<GeneratedCaption>;
  if (!parsed.headline || !parsed.body) {
    throw new Error("Resposta da IA não contém headline/body válidos");
  }
  return { headline: parsed.headline, body: parsed.body };
}
