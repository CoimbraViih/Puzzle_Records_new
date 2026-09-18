import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const maybeSingle = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: () => ({ eq: () => ({ eq: () => ({ select: vi.fn() }) }) }),
    }),
  }),
}));

vi.mock("@/lib/audit/log-system-event", () => ({ logSystemAuditEvent: vi.fn() }));
vi.mock("@/workers/queues", () => ({ publishQueue: { add: vi.fn() } }));
vi.mock("@/lib/queue/trigger", () => ({ triggerQueueDrain: vi.fn() }));

process.env.CREATOMATE_WEBHOOK_SECRET = "segredo-correto";

import { POST } from "./route";

function makeRequest(url: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "render-1", status: "succeeded", url: "https://cdn.creatomate.com/x.mp4" }),
  });
}

describe("POST /api/creatomate/webhook — autenticação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 quando o token não bate com CREATOMATE_WEBHOOK_SECRET", async () => {
    const request = makeRequest("http://localhost/api/creatomate/webhook?token=errado&item=abc");

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o parâmetro item está ausente", async () => {
    const request = makeRequest("http://localhost/api/creatomate/webhook?token=segredo-correto");

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });
});
