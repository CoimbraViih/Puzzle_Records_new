import type { ZernioClient, ZernioPublishInput, ZernioPublishResult, ZernioAnalytics } from "./zernio-client";

export function getMockZernioClient(): ZernioClient {
  return {
    async publish(input: ZernioPublishInput): Promise<ZernioPublishResult> {
      console.log(
        `[zernio:mock] publicaria no Instagram (conta ${input.instagramAccountId}): "${input.captionText.slice(0, 80)}..." — vídeo: ${input.videoUrl}`,
      );
      return {
        postId: `mock-${Date.now()}`,
        permalink: null,
        publishedAtUtc: new Date().toISOString(),
      };
    },

    async getAnalytics(): Promise<ZernioAnalytics> {
      return { reach: 0, engagement: 0, impressions: 0 };
    },
  };
}
