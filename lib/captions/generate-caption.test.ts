import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const update = vi.fn();
const requestCaption = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update,
    }),
  }),
}));

vi.mock("./openrouter-client", () => ({
  requestCaptionFromOpenRouter: (...args: unknown[]) => requestCaption(...args),
}));

vi.mock("@/lib/audit/log-system-event", () => ({ logSystemAuditEvent: vi.fn() }));
vi.mock("@/workers/queues", () => ({ renderQueue: { add: vi.fn() } }));
vi.mock("@/lib/queue/trigger", () => ({ triggerQueueDrain: vi.fn() }));

import { processCaptionJob } from "./generate-caption";

describe("processCaptionJob — guarda de idempotência", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("é no-op quando o item já saiu de 'recebido'", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "item-1", status: "legenda", title: "t", author: "a", origin: "drive" },
      error: null,
    });

    await processCaptionJob({ pipelineItemId: "item-1" });

    expect(requestCaption).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("é no-op quando o item não existe", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await processCaptionJob({ pipelineItemId: "sumiu" });

    expect(requestCaption).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
