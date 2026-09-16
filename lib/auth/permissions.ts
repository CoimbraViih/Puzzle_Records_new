export type UserRole = "operador" | "aprovador" | "gestor";

type RoutePermission = {
  prefix: string;
  roles: UserRole[];
};

// Regras avaliadas na ordem declarada; a primeira que casar com o prefixo decide.
const ROUTE_PERMISSIONS: RoutePermission[] = [
  { prefix: "/dashboard/configuracoes", roles: ["gestor"] },
  { prefix: "/dashboard/aprovacoes", roles: ["aprovador", "gestor"] },
  { prefix: "/dashboard/kanban", roles: ["operador", "aprovador", "gestor"] },
  { prefix: "/dashboard", roles: ["operador", "aprovador", "gestor"] },
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
