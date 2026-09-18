"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function Topbar({ email }: { email: string }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      // Mesmo se o signOut falhar (ex.: offline), mandamos o usuário para
      // /login de qualquer forma — o proxy revalida a sessão na próxima
      // requisição, então não faz sentido prendê-lo na tela atual.
      console.error("Topbar: signOut failed", err);
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
      <span className="font-display text-base font-semibold tracking-tight">Painel operacional</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">{email}</span>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
