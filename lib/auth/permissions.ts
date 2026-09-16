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

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  const rule = ROUTE_PERMISSIONS.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return false;
  return rule.roles.includes(role);
}
