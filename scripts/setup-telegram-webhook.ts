// scripts/setup-telegram-webhook.ts
// Rodar manualmente uma vez (e de novo se PUBLIC_BASE_URL ou o secret mudarem):
//   npx tsx scripts/setup-telegram-webhook.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { Bot } from "grammy";
import { requireEnv } from "../lib/ingestion/cron-auth";

async function main() {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const webhookSecret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  const publicBaseUrl = requireEnv("PUBLIC_BASE_URL");

  const bot = new Bot(botToken);
  await bot.api.setWebhook(`${publicBaseUrl}/api/telegram/webhook`, {
    secret_token: webhookSecret,
  });
  const info = await bot.api.getWebhookInfo();
  console.log("Webhook registrado:", info);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
