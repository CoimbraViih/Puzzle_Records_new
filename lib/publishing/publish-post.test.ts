import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const update = vi.fn();
const publish = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update,
    }),
  }),
}));

vi.mock("./zernio-client", () => ({
  getZernioClient: () => ({ publish }),
}));

vi.mock("@/lib/audit/log-system-event", () => ({ logSystemAuditEvent: vi.fn() }));

import { processPublishJob } from "./publish-post";

const COMPLETE_ITEM = {
  id: "item-1",
  render_url: "https://cdn.creatomate.com/render.mp4",
  caption_headline: "MANCHETE",
  caption_body: "corpo",
};

describe("processPublishJob — guarda contra publicação indevida", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("não publica quando o item não está em 'renderizando' (já publicado)", async () => {
    maybeSingle.mockResolvedValue({ data: { ...COMPLETE_ITEM, status: "publicado" }, error: null });

    await processPublishJob({ pipelineItemId: "item-1" });

    expect(publish).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("não publica um item ainda em 'legenda' mesmo com render_url preenchida (C2)", async () => {
    maybeSingle.mockResolvedValue({ data: { ...COMPLETE_ITEM, status: "legenda" }, error: null });

    await processPublishJob({ pipelineItemId: "item-1" });

    expect(publish).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("não publica sem legenda gerada", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...COMPLETE_ITEM, status: "renderizando", caption_body: null },
      error: null,
    });

    await processPublishJob({ pipelineItemId: "item-1" });

    expect(publish).not.toHaveBeenCalled();
  });
});
