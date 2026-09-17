// scripts/setup-telegram-webhook.ts
// Rodar manualmente uma vez (e de novo se PUBLIC_BASE_URL ou o secret mudarem):
//   npx tsx scripts/setup-telegram-webhook.ts
import "dotenv/config";
import { Bot } from "grammy";

async function main() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  await bot.api.setWebhook(`${process.env.PUBLIC_BASE_URL}/api/telegram/webhook`, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  const info = await bot.api.getWebhookInfo();
  console.log("Webhook registrado:", info);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
