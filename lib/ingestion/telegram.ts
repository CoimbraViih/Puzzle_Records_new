import { Bot, webhookCallback, type Context } from "grammy";
import { createClient } from "@supabase/supabase-js";
import { upsertPipelineItem } from "./pipeline-items";
import { requireEnv } from "./cron-auth";

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

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function createTelegramBot() {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const bot = new Bot(botToken);

  bot.on("message", async (ctx) => {
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
    // upsert: false + statusCode "409" (already exists) é esperado em reentrega do Telegram — ignora silenciosamente.
    if (uploadError && uploadError.statusCode !== "409") {
      console.error("[telegram] falha ao subir mídia para o Supabase Storage", uploadError);
      await ctx.reply("Não consegui salvar o arquivo. Tente enviar novamente.");
      return;
    }

    const author = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "desconhecido");

    await upsertPipelineItem({
      origin: "telegram",
      externalId: media.fileUniqueId,
      title: media.caption,
      author,
      mimeType: media.mimeType,
      storagePath,
      metadata: { chatId: ctx.chat?.id },
    });

    await ctx.reply("Recebido! Já apareceu no Kanban em 'recebido'.");
  });

  return bot;
}

export function getTelegramWebhookHandler() {
  const bot = createTelegramBot();
  return webhookCallback(bot, "std/http", {
    secretToken: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  });
}
