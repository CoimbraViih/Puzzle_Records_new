import { describe, expect, it } from "vitest";
import { canAccessRoute, type UserRole } from "./permissions";

describe("canAccessRoute", () => {
  it("permite gestor acessar qualquer rota do dashboard", () => {
    expect(canAccessRoute("gestor", "/dashboard/kanban")).toBe(true);
    expect(canAccessRoute("gestor", "/dashboard/aprovacoes")).toBe(true);
  });

  it("bloqueia operador de acessar aprovações", () => {
    expect(canAccessRoute("operador", "/dashboard/aprovacoes")).toBe(false);
  });

  it("permite operador acessar o dashboard raiz e o kanban", () => {
    expect(canAccessRoute("operador", "/dashboard")).toBe(true);
    expect(canAccessRoute("operador", "/dashboard/kanban")).toBe(true);
  });

  it("permite aprovador acessar aprovações mas não configurações de gestor", () => {
    expect(canAccessRoute("aprovador", "/dashboard/aprovacoes")).toBe(true);
    expect(canAccessRoute("aprovador", "/dashboard/configuracoes")).toBe(false);
  });

  it("retorna false para papel desconhecido", () => {
    expect(canAccessRoute("desconhecido" as UserRole, "/dashboard")).toBe(false);
  });

  it("não trata /dashboard/kanban-interno como sub-rota de /dashboard/kanban (colisão de prefixo)", () => {
    // Deve cair na regra menos específica "/dashboard", não na de "/dashboard/kanban".
    expect(canAccessRoute("operador", "/dashboard/kanban-interno")).toBe(true);
    expect(canAccessRoute("aprovador", "/dashboard/kanban-interno")).toBe(true);
    expect(canAccessRoute("gestor", "/dashboard/kanban-interno")).toBe(true);
  });
});
