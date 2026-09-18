"use client";

import { useEffect } from "react";

/**
 * Error boundary de `/dashboard/*`. A causa mais comum aqui é uma migration
 * do Supabase que ainda não foi aplicada no ambiente (as migrations deste
 * projeto são aplicadas à mão pelo SQL Editor), o que faz o select das
 * páginas quebrar com "column does not exist" e derrubaria o Kanban inteiro.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] erro ao carregar a página:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg p-8">
      <h2 className="text-lg font-semibold">Erro ao carregar dados do pipeline</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Verifique se todas as migrations do Supabase foram aplicadas (ver <code>.docs/PLAN.md</code>).
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        Tentar novamente
      </button>
    </div>
  );
}
