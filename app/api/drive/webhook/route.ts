// app/api/drive/webhook/route.ts
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncDriveChanges } from "@/lib/ingestion/google-drive";
import { requireEnv } from "@/lib/ingestion/cron-auth";

export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-goog-channel-token");
  const expectedToken = requireEnv("GOOGLE_DRIVE_WEBHOOK_TOKEN");
  if (!safeCompare(token ?? "", expectedToken)) {
    return NextResponse.json({ error: "invalid channel token" }, { status: 401 });
  }

  const resourceState = request.headers.get("x-goog-resource-state");
  // "sync" é só o ping de confirmação ao criar o channel — nada pra processar ainda.
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  try {
    await syncDriveChanges();
  } catch (error) {
    console.error("[drive/webhook] falha ao sincronizar changes", error);
    // Responde 200 mesmo assim: o Google reenvia notificações "resource_state"
    // repetidas indefinidamente em caso de erro persistente, e o polling (Tarefa 6)
    // é a rede de segurança real contra perda de eventos.
  }

  return new NextResponse(null, { status: 200 });
}
