"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { matchesPrefix, type UserRole } from "@/lib/auth/permissions";

const NAV_ITEMS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: "/dashboard", label: "Início", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/kanban", label: "Kanban", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/calendario", label: "Calendário", roles: ["editorial", "admin"] },
  { href: "/dashboard/analytics", label: "Analytics", roles: ["editorial", "admin"] },
  { href: "/dashboard/aprovacoes", label: "Aprovações", roles: ["editorial", "admin"] },
  { href: "/dashboard/configuracoes", label: "Configurações", roles: ["admin"] },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface p-4">
      <div className="mb-6 px-1">
        <span className="font-display text-xl font-bold tracking-tight text-brand">Puzzle Records</span>
      </div>
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => {
          // "/dashboard" é caso especial: não deve ficar ativo para toda
          // sub-rota (senão "Início" apareceria sempre destacado).
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : matchesPrefix(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted",
                isActive && "bg-brand-soft font-semibold text-brand hover:bg-brand-soft"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
