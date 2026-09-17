import { getMockZernioClient } from "./mock-zernio-client";

export interface ZernioPublishInput {
  instagramAccountId: string;
  videoUrl: string;
  captionText: string;
}

export interface ZernioPublishResult {
  postId: string;
  permalink: string | null;
  publishedAtUtc: string;
}

export interface ZernioAnalytics {
  reach: number;
  engagement: number;
  impressions: number;
}

export interface ZernioClient {
  publish(input: ZernioPublishInput): Promise<ZernioPublishResult>;
  getAnalytics(postId: string): Promise<ZernioAnalytics>;
}

/**
 * Stub fail-closed: a API real do Zernio ainda não foi documentada pelo
 * usuário. Em vez de adivinhar endpoints, este cliente falha alto e aponta
 * para onde implementar — mesmo espírito do requireEnv() já usado no
 * projeto (falhar de forma óbvia em vez de silenciosa).
 */
class RealZernioClient implements ZernioClient {
  async publish(): Promise<ZernioPublishResult> {
    throw new Error(
      "RealZernioClient ainda não implementado — falta a documentação real da API do Zernio " +
        "(ver Task 9 de docs/superpowers/plans/2026-09-17-fase-2-3-5-pipeline-completo.md).",
    );
  }

  async getAnalytics(): Promise<ZernioAnalytics> {
    throw new Error("RealZernioClient ainda não implementado — falta a documentação real da API do Zernio.");
  }
}

export function getZernioClient(): ZernioClient {
  if (process.env.ZERNIO_API_KEY) {
    return new RealZernioClient();
  }
  return getMockZernioClient();
}
