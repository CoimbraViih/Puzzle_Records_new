"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { testConnectionAction } from "./actions";
import type { ConnectionStatus, TestableIntegrationKey } from "@/lib/connections/status";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Configurado",
  not_configured: "Não configurado",
};

export function ConnectionCard({
  integrationKey,
  title,
  description,
  status,
  testable = true,
}: {
  integrationKey: string;
  title: string;
  description: string;
  status: ConnectionStatus;
  testable?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleTest() {
    setResult(null);
    startTransition(async () => {
      const outcome = await testConnectionAction(integrationKey as TestableIntegrationKey);
      setResult(outcome);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <span
            className={
              status === "connected"
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {STATUS_LABEL[status]}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {testable && (
          <Button variant="outline" size="sm" onClick={handleTest} disabled={isPending || status !== "connected"}>
            {isPending ? "Testando..." : "Testar conexão"}
          </Button>
        )}
        {testable && status !== "connected" && (
          <p className="text-xs text-muted-foreground">Configure as variáveis de ambiente para habilitar o teste.</p>
        )}
        {result && (
          <p className={result.ok ? "text-xs text-green-700" : "text-xs text-destructive"}>{result.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
