export type UserRole = "equipe_conteudo" | "editorial" | "admin";

export function isUserRole(value: unknown): value is UserRole {
  return value === "equipe_conteudo" || value === "editorial" || value === "admin";
}

type RoutePermission = {
  prefix: string;
  roles: UserRole[];
};

// Regras avaliadas na ordem declarada; a primeira que casar com o prefixo decide.
const ROUTE_PERMISSIONS: RoutePermission[] = [
  { prefix: "/dashboard/configuracoes", roles: ["admin"] },
  { prefix: "/dashboard/aprovacoes", roles: ["editorial", "admin"] },
  { prefix: "/dashboard/kanban", roles: ["equipe_conteudo", "editorial", "admin"] },
  { prefix: "/dashboard/calendario", roles: ["editorial", "admin"] },
  { prefix: "/dashboard/analytics", roles: ["editorial", "admin"] },
  { prefix: "/dashboard", roles: ["equipe_conteudo", "editorial", "admin"] },
];

export function matchesPrefix(pathname: string, prefix: string): boolean {
  // Respeita fronteiras de segmento de path: "/dashboard/kanban-interno" NÃO
  // deve casar com o prefixo "/dashboard/kanban" só porque é um prefixo de
  // string — precisa ser exatamente o prefixo ou ter "/" logo em seguida.
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  const rule = ROUTE_PERMISSIONS.find((r) => matchesPrefix(pathname, r.prefix));
  if (!rule) return false;
  return rule.roles.includes(role);
}
