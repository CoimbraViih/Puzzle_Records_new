import { describe, it, expect, vi, beforeEach } from "vitest";

const captionAdd = vi.fn();
const renderAdd = vi.fn();
const publishAdd = vi.fn();

vi.mock("@/workers/queues", () => ({
  captionQueue: { add: (...args: unknown[]) => captionAdd(...args) },
  renderQueue: { add: (...args: unknown[]) => renderAdd(...args) },
  publishQueue: { add: (...args: unknown[]) => publishAdd(...args) },
}));

// Mock encadeável mínimo: cada chamada de método builder guarda os
// argumentos e devolve `this`; a query resolve só quando "await"ada.
function makeQueryResult(rows: Array<{ id: string }>) {
  const result: Record<string, unknown> = {
    eq: () => result,
    is: () => result,
    not: () => result,
    lt: () => result,
    then: (resolve: (value: { data: Array<{ id: string }>; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return result;
}

const fromMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

import { reconcileStuckPipelineItems } from "./reconcile";

describe("reconcileStuckPipelineItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reenfileira itens presos em cada etapa e ignora os que já têm erro registrado", async () => {
    fromMock.mockImplementation(() => ({
      select: () => makeQueryResult([{ id: "recebido-1" }]),
    }));
    // A implementação chama .from() três vezes (uma por etapa); alternamos o
    // retorno por chamada para simular resultados diferentes por etapa.
    fromMock
      .mockImplementationOnce(() => ({ select: () => makeQueryResult([{ id: "recebido-1" }]) }))
      .mockImplementationOnce(() => ({ select: () => makeQueryResult([{ id: "legenda-1" }, { id: "legenda-2" }]) }))
      .mockImplementationOnce(() => ({ select: () => makeQueryResult([]) }));

    const result = await reconcileStuckPipelineItems();

    expect(captionAdd).toHaveBeenCalledWith("caption", { pipelineItemId: "recebido-1" });
    expect(renderAdd).toHaveBeenCalledTimes(2);
    expect(renderAdd).toHaveBeenCalledWith("render", { pipelineItemId: "legenda-1" });
    expect(renderAdd).toHaveBeenCalledWith("render", { pipelineItemId: "legenda-2" });
    expect(publishAdd).not.toHaveBeenCalled();
    expect(result).toEqual({ requeuedCaption: 1, requeuedRender: 2, requeuedPublish: 0 });
  });

  it("propaga erro de consulta sem reenfileirar nada", async () => {
    fromMock.mockImplementationOnce(() => ({
      select: () => ({
        eq: function (this: unknown) {
          return this;
        },
        is: function (this: unknown) {
          return this;
        },
        lt: function (this: unknown) {
          return this;
        },
        then: (resolve: (value: { data: null; error: Error }) => void) =>
          resolve({ data: null, error: new Error("db indisponível") }),
      }),
    }));

    await expect(reconcileStuckPipelineItems()).rejects.toThrow("db indisponível");
    expect(captionAdd).not.toHaveBeenCalled();
  });
});
