import { requireEnv } from "@/lib/ingestion/cron-auth";
import type { ZernioAnalytics, ZernioClient, ZernioPublishInput, ZernioPublishResult } from "./zernio-client";

const DEFAULT_API_BASE_URL = "https://zernio.com/api";

/**
 * Um 409 do Zernio é o próprio guard de idempotência dele dizendo "esse
 * conteúdo já foi publicado nas últimas 24h" — ou seja, o post JÁ ESTÁ no ar,
 * o oposto de "ainda não publicado". Se o corpo desse 409 vier vazio/não-JSON
 * não há como extrair o postId/permalink, mas ainda assim NÃO é seguro tratar
 * como "falha transitória, pode re-tentar": re-tentar só vai bater no mesmo
 * 409 de novo, e propagar isso como erro genérico faz `processPublishJob`
 * relançar para o `drainQueue` re-tentar — que depois de esgotar as
 * tentativas descarta o job e deixa o item preso em "renderizando" com um
 * `publish_error` como se nada tivesse sido publicado, quando na verdade o
 * post está ao vivo no Instagram. Ver `lib/publishing/publish-post.ts`, que
 * trata esta classe de erro sem relançar (não adianta re-tentar).
 */
export class ZernioAmbiguousPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZernioAmbiguousPublishError";
  }
}

interface ZernioPlatformResult {
  platform: string;
  status: string;
  platformPostUrl?: string | null;
  errorMessage?: string;
}

interface ZernioCreatePostResponse {
  post: {
    _id: string;
    status: string;
    platforms: ZernioPlatformResult[];
  };
  existingPost?: ZernioCreatePostResponse["post"];
}

interface ZernioAnalyticsResponse {
  posts?: Array<{
    analytics?: {
      impressions?: number;
      reach?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      saves?: number;
    };
  }>;
}

function getConfig() {
  return {
    baseUrl: process.env.ZERNIO_API_BASE_URL || DEFAULT_API_BASE_URL,
    apiKey: requireEnv("ZERNIO_API_KEY"),
  };
}

async function zernioFetch(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const { baseUrl, apiKey } = getConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return response;
}

/**
 * Cliente real do Zernio (rebrand de "Late" — api.zernio.com/api, ver
 * docs.zernio.com). Publica direto via POST /v1/posts com publishNow: true;
 * o `idempotencyKey` (pipelineItemId) vai no header x-request-id para que um
 * retry do drain da fila não publique o mesmo post duas vezes (janela de
 * ~5 min do lado do Zernio, ver guia de idempotência).
 */
class RealZernioClient implements ZernioClient {
  async publish(input: ZernioPublishInput): Promise<ZernioPublishResult> {
    const response = await zernioFetch("/v1/posts", {
      method: "POST",
      headers: { "x-request-id": input.idempotencyKey },
      body: JSON.stringify({
        content: input.captionText,
        mediaItems: [{ type: "video", url: input.videoUrl }],
        platforms: [{ platform: "instagram", accountId: input.instagramAccountId }],
        publishNow: true,
      }),
    });

    if (!response.ok && response.status !== 409) {
      const body = await response.text();
      throw new Error(`Zernio publish falhou (${response.status}): ${body}`);
    }

    // Um 409 (idempotência por conteúdo em 24h) pode vir com corpo vazio —
    // response.json() direto lançaria SyntaxError nesse caso. Parseamos como
    // texto primeiro para diferenciar "sem corpo" de "JSON inválido" e dar um
    // erro claro; retry é seguro de qualquer forma porque o x-request-id/
    // idempotência do próprio Zernio impede duplicar o post.
    const rawBody = await response.text();
    let payload: ZernioCreatePostResponse;
    try {
      payload = JSON.parse(rawBody) as ZernioCreatePostResponse;
    } catch {
      if (response.status === 409) {
        throw new ZernioAmbiguousPublishError(
          `Zernio retornou 409 (idempotência — post provavelmente já publicado) sem corpo JSON utilizável para confirmar; verificar manualmente no Instagram antes de re-tentar (corpo: ${rawBody.slice(0, 200)})`,
        );
      }
      throw new Error(
        `Zernio publish retornou ${response.status} sem corpo JSON utilizável (corpo: ${rawBody.slice(0, 200)})`,
      );
    }
    const post = payload.existingPost ?? payload.post;
    if (!post) {
      throw new Error(`Zernio publish (${response.status}) não retornou nem "post" nem "existingPost": ${rawBody.slice(0, 200)}`);
    }
    const instagramResult = post.platforms.find((p) => p.platform === "instagram");

    if (!instagramResult || instagramResult.status === "failed") {
      throw new Error(
        `Zernio não publicou no Instagram: ${instagramResult?.errorMessage ?? post.status ?? "status desconhecido"}`,
      );
    }

    return {
      postId: post._id,
      permalink: instagramResult.platformPostUrl ?? null,
      publishedAtUtc: new Date().toISOString(),
    };
  }

  async getAnalytics(postId: string): Promise<ZernioAnalytics> {
    const response = await zernioFetch(`/v1/analytics?postId=${encodeURIComponent(postId)}`, { method: "GET" });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Zernio analytics falhou (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as ZernioAnalyticsResponse;
    const analytics = payload.posts?.[0]?.analytics;
    if (!analytics) {
      return { reach: 0, engagement: 0, impressions: 0 };
    }

    return {
      reach: analytics.reach ?? 0,
      impressions: analytics.impressions ?? 0,
      engagement: (analytics.likes ?? 0) + (analytics.comments ?? 0) + (analytics.shares ?? 0) + (analytics.saves ?? 0),
    };
  }
}

export function getRealZernioClient(): ZernioClient {
  return new RealZernioClient();
}
