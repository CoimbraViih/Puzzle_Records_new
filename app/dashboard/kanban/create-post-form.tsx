"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createManualPipelineItemAction, type CreateManualPostState } from "./actions";

const INITIAL_STATE: CreateManualPostState = { error: null, success: false };

export function CreatePostForm() {
  const [state, formAction, isPending] = useActionState(createManualPipelineItemAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="space-y-1">
        <Label htmlFor="title">Manchete / título</Label>
        <Input id="title" name="title" placeholder="ex.: Show da Fresno em SP" required className="w-64" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="mediaUrl">URL pública da foto/vídeo (https)</Label>
        <Input id="mediaUrl" name="mediaUrl" placeholder="https://..." required className="w-80" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Criando..." : "Criar post"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state.success && (
        <p className="w-full text-sm text-good">Item criado em &quot;recebido&quot; e enfileirado para gerar legenda.</p>
      )}
    </form>
  );
}
