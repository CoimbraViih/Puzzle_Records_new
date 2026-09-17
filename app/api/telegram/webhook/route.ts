import { getTelegramWebhookHandler } from "@/lib/ingestion/telegram";

export const dynamic = "force-dynamic";

let handler: ReturnType<typeof getTelegramWebhookHandler> | null = null;

export async function POST(request: Request) {
  handler ??= getTelegramWebhookHandler();
  return handler(request);
}
