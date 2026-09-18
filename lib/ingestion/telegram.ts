import { Bot, webhookCallback, type Context } from "grammy";
import { upsertPipelineItem } from "./pipeline-items";
import { requireEnv } from "./cron-auth";
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

interface ExtractedMedia {
  fileId: string;
  fileUniqueId: string;
  mimeType: string;
  caption: string | null;
}

export function extractMediaFromMessage(message: Context["message"]): ExtractedMedia | null {
  if (!message) return null;
  const caption = "caption" in message ? message.caption ?? null : null;

  if ("photo" in message && message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id, mimeType: "image/jpeg", caption };
  }

  if ("video" in message && message.video) {
    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type ?? "video/mp4",
      caption,
    };
  }

  return null;
}

// Allowlist de chat/user IDs do Telegram autorizados a usar o bot. Sem essa
// checagem, qualquer pessoa que encontre o username do bot poderia empurrar
// mídia para o pipeline (custo de Storage ilimitado + injeção de conteúdo).
// Fail-closed: lista ausente/vazia = ninguém autorizado (não fail-open).
let warnedMissingAllowlist = false;

function getAllowedChatIds(): number[] {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter((id) => Number.isFinite(id));
}

function isChatAllowed(chatId: number | undefined): boolean {
  const allowed = getAllowedChatIds();
  if (allowed.length === 0) {
    if (!warnedMissingAllowlist) {
      warnedMissingAllowlist = true;
      console.warn(
        "[telegram] TELEGRAM_ALLOWED_CHAT_IDS não configurado ou vazio — bloqueando todas as mensagens (fail-closed).",
      );
    }
    return false;
  }
  return chatId !== undefined && allowed.includes(chatId);
}

export function createTelegramBot() {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const bot = new Bot(botToken);

  bot.on("message", async (ctx) => {
    if (!isChatAllowed(ctx.chat?.id)) {
      await ctx.reply("Este bot é de uso restrito.");
      return;
    }

    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply("Envie uma foto ou vídeo para entrar no pipeline. Legenda opcional vira o gancho inicial.");
      return;
    }

    let fileBytes: Uint8Array;
    try {
      const file = await ctx.api.getFile(media.fileId);
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error(`download do arquivo do Telegram falhou com status ${fileResponse.status}`);
      }
      fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    } catch (error) {
      // Nunca logar o objeto de erro cru aqui: o fetch acima embute o bot
      // token na URL, e implementações de fetch (undici) costumam colocar a
      // URL completa dentro de error.message/error.cause em falhas de
      // rede/DNS/TLS — logar isso vazaria o token em texto plano nos logs.
      const safeMessage =
        error instanceof Error
          ? error.message.replaceAll(botToken, "***")
          : String(error).replaceAll(botToken, "***");
      console.error("[telegram] falha ao baixar mídia do Telegram:", safeMessage);
      await ctx.reply("Não consegui baixar o arquivo. Tente enviar novamente.");
      return;
    }

    const extension = media.mimeType.startsWith("video") ? "mp4" : "jpg";
    const storagePath = `telegram/${media.fileUniqueId}.${extension}`;

    const supabase = getServiceRoleClient();
    const { error: uploadError } = await supabase.storage
      .from("raw-media")
      .upload(storagePath, fileBytes, { contentType: media.mimeType, upsert: false });
    // upsert: false + status 409 / statusCode "409" (already exists) é esperado em reentrega do Telegram — ignora silenciosamente.
    if (uploadError && uploadError.status !== 409 && uploadError.statusCode !== "409") {
      console.error("[telegram] falha ao subir mídia para o Supabase Storage", uploadError);
      await ctx.reply("Não consegui salvar o arquivo. Tente enviar novamente.");
      return;
    }

    const author = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "desconhecido");

    const result = await upsertPipelineItem({
      origin: "telegram",
      externalId: media.fileUniqueId,
      title: media.caption,
      author,
      mimeType: media.mimeType,
      storagePath,
      metadata: { chatId: ctx.chat?.id },
    });

    if (result) {
      await captionQueue.add("caption", { pipelineItemId: result.id });
      triggerQueueDrain();
    }

    await ctx.reply("Recebido! Já apareceu no Kanban em 'recebido'.");
  });

  return bot;
}

export function getTelegramWebhookHandler() {
  const bot = createTelegramBot();
  return webhookCallback(bot, "std/http", {
    secretToken: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
    timeoutMilliseconds: 25000,
  });
}
