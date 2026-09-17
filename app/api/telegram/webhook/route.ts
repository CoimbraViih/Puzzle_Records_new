import { getTelegramWebhookHandler } from "@/lib/ingestion/telegram";

export const dynamic = "force-dynamic";

export const POST = getTelegramWebhookHandler();
