"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/permissions";

const NAV_ITEMS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: "/dashboard", label: "Início", roles: ["operador", "aprovador", "gestor"] },
  { href: "/dashboard/kanban", label: "Kanban", roles: ["operador", "aprovador", "gestor"] },
  { href: "/dashboard/aprovacoes", label: "Aprovações", roles: ["aprovador", "gestor"] },
  { href: "/dashboard/configuracoes", label: "Configurações", roles: ["gestor"] },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 p-4">
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium hover:bg-muted",
              pathname === item.href && "bg-muted"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
