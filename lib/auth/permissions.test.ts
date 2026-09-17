import { describe, expect, it } from "vitest";
import { canAccessRoute, isUserRole, type UserRole } from "./permissions";

describe("canAccessRoute", () => {
  it("permite admin acessar qualquer rota do dashboard", () => {
    expect(canAccessRoute("admin", "/dashboard/kanban")).toBe(true);
    expect(canAccessRoute("admin", "/dashboard/aprovacoes")).toBe(true);
  });

  it("bloqueia equipe_conteudo de acessar aprovações", () => {
    expect(canAccessRoute("equipe_conteudo", "/dashboard/aprovacoes")).toBe(false);
  });

  it("permite equipe_conteudo acessar o dashboard raiz e o kanban", () => {
    expect(canAccessRoute("equipe_conteudo", "/dashboard")).toBe(true);
    expect(canAccessRoute("equipe_conteudo", "/dashboard/kanban")).toBe(true);
  });

  it("permite editorial acessar aprovações mas não configurações de admin", () => {
    expect(canAccessRoute("editorial", "/dashboard/aprovacoes")).toBe(true);
    expect(canAccessRoute("editorial", "/dashboard/configuracoes")).toBe(false);
  });

  it("retorna false para papel desconhecido", () => {
    expect(canAccessRoute("desconhecido" as UserRole, "/dashboard")).toBe(false);
  });

  it("não trata /dashboard/kanban-interno como sub-rota de /dashboard/kanban (colisão de prefixo)", () => {
    // Deve cair na regra menos específica "/dashboard", não na de "/dashboard/kanban".
    expect(canAccessRoute("equipe_conteudo", "/dashboard/kanban-interno")).toBe(true);
    expect(canAccessRoute("editorial", "/dashboard/kanban-interno")).toBe(true);
    expect(canAccessRoute("admin", "/dashboard/kanban-interno")).toBe(true);
  });

  it("não trata /dashboard/aprovacoes-interno como sub-rota de /dashboard/aprovacoes", () => {
    // /dashboard/aprovacoes só permite editorial/admin; /dashboard permite todos.
    // Um startsWith ingênuo cairia na regra de aprovações e bloquearia o equipe_conteudo
    // aqui — esse caso de fato distingue o matching correto do buggy.
    expect(canAccessRoute("equipe_conteudo", "/dashboard/aprovacoes-interno")).toBe(true);
    expect(canAccessRoute("editorial", "/dashboard/aprovacoes-interno")).toBe(true);
    expect(canAccessRoute("admin", "/dashboard/aprovacoes-interno")).toBe(true);
  });
});

describe("isUserRole", () => {
  it("aceita os três papéis válidos", () => {
    expect(isUserRole("equipe_conteudo")).toBe(true);
    expect(isUserRole("editorial")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
  });

  it("rejeita undefined, null, string vazia e valores arbitrários", () => {
    expect(isUserRole(undefined)).toBe(false);
    expect(isUserRole(null)).toBe(false);
    expect(isUserRole("")).toBe(false);
    expect(isUserRole("desconhecido")).toBe(false);
  });
});
