import { getMockZernioClient } from "./mock-zernio-client";
import { getRealZernioClient } from "./real-zernio-client";

export interface ZernioPublishInput {
  instagramAccountId: string;
  videoUrl: string;
  captionText: string;
  /** Chave estável (ex: pipelineItemId) enviada como x-request-id para o Zernio não publicar duas vezes em caso de retry. */
  idempotencyKey: string;
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

export function getZernioClient(): ZernioClient {
  if (process.env.ZERNIO_API_KEY) {
    return getRealZernioClient();
  }
  return getMockZernioClient();
}
