import { NextRequest, NextResponse } from "next/server";
import { ensureDriveWatchChannel } from "@/lib/ingestion/google-drive";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ensureDriveWatchChannel();
  return NextResponse.json(result);
}
