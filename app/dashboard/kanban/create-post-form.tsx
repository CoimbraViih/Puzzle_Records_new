"use client";

import { useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createManualPipelineItemAction, MAX_MEDIA_BYTES, type CreateManualPostState } from "./actions";

const INITIAL_STATE: CreateManualPostState = { error: null, success: false };
const MAX_MEDIA_MB = Math.floor(MAX_MEDIA_BYTES / (1024 * 1024));

/**
 * Um arquivo maior que o limite configurado em next.config.ts
 * (experimental.serverActions.bodySizeLimit) é rejeitado pelo próprio
 * Next.js antes da Server Action rodar — sem chance de capturar o erro e
 * devolver uma mensagem amigável, só o error boundary genérico do dashboard
 * (bug real que aconteceu em produção com um vídeo real). Por isso validamos
 * o tamanho aqui, no navegador, ANTES de sequer tentar enviar.
 */
export function CreatePostForm() {
  const [state, formAction, isPending] = useActionState(createManualPipelineItemAction, INITIAL_STATE);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && file.size > MAX_MEDIA_BYTES) {
      setClientError(`Arquivo de ${(file.size / (1024 * 1024)).toFixed(1)}MB acima do limite de ${MAX_MEDIA_MB}MB. Comprima ou corte o vídeo antes de enviar.`);
      event.target.value = "";
    } else {
      setClientError(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file || file.size > MAX_MEDIA_BYTES) {
      event.preventDefault();
      if (!file) setClientError("Selecione um arquivo de vídeo ou foto para enviar.");
    }
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="space-y-1">
        <Label htmlFor="file">Vídeo ou foto (máx. {MAX_MEDIA_MB}MB)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="video/*,image/*"
          required
          onChange={handleFileChange}
          className="w-72"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Enviando..." : "Criar post"}
      </Button>
      {clientError && <p className="w-full text-sm text-destructive">{clientError}</p>}
      {!clientError && state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state.success && (
        <p className="w-full text-sm text-good">
          Item criado em &quot;recebido&quot; — a IA vai gerar manchete e legenda automaticamente.
        </p>
      )}
    </form>
  );
}
