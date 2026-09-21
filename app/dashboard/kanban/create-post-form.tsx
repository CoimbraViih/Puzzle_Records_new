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
        <Label htmlFor="file">Vídeo ou foto</Label>
        <Input id="file" name="file" type="file" accept="video/*,image/*" required className="w-72" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Enviando..." : "Criar post"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state.success && (
        <p className="w-full text-sm text-good">
          Item criado em &quot;recebido&quot; — a IA vai gerar manchete e legenda automaticamente.
        </p>
      )}
    </form>
  );
}
