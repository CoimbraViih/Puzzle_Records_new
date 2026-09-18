"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreateApiKeyState,
  type RevokeApiKeyState,
} from "./actions";
import type { ApiKeyRow } from "@/lib/api-keys/api-keys";

const CREATE_INITIAL_STATE: CreateApiKeyState = { error: null, plaintext: null, name: null };
const REVOKE_INITIAL_STATE: RevokeApiKeyState = { error: null };

function RevokeButton({ id }: { id: string }) {
  const [state, formAction, isPending] = useActionState(revokeApiKeyAction, REVOKE_INITIAL_STATE);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="destructive" size="xs" disabled={isPending}>
        {isPending ? "Revogando..." : "Revogar"}
      </Button>
      {state.error && <span className="ml-2 text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

export function ApiKeysSection({ keys, webhookUrl }: { keys: ApiKeyRow[]; webhookUrl: string }) {
  const [state, formAction, isPending] = useActionState(createApiKeyAction, CREATE_INITIAL_STATE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Keys</CardTitle>
        <CardDescription>
          Chaves usadas por sistemas externos (ex.: n8n) para autenticar chamadas ao webhook de ingestão em{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{webhookUrl}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={formAction} className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="name">Nome da chave</Label>
            <Input id="name" name="name" placeholder="ex.: n8n produção" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Criando..." : "Criar chave"}
          </Button>
        </form>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        {state.plaintext && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm">
            <p className="font-medium">Chave &quot;{state.name}&quot; criada. Copie agora — ela não será mostrada de novo:</p>
            <code className="mt-2 block break-all rounded bg-background p-2 text-xs">{state.plaintext}</code>
          </div>
        )}

        <div className="space-y-2">
          {keys.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div>
                <p className="font-medium">
                  {key.name} <span className="font-mono text-xs text-muted-foreground">{key.key_prefix}…</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  criada em {new Date(key.created_at).toLocaleString("pt-BR")}
                  {key.last_used_at && ` · último uso em ${new Date(key.last_used_at).toLocaleString("pt-BR")}`}
                  {key.revoked_at && " · revogada"}
                </p>
              </div>
              {!key.revoked_at && <RevokeButton id={key.id} />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
