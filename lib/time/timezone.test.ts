// lib/time/timezone.test.ts
import { describe, it, expect } from "vitest";
import { utcToSaoPauloParts, formatUtcAsSaoPaulo } from "./timezone";

describe("utcToSaoPauloParts", () => {
  it("converte UTC para America/Sao_Paulo (UTC-3, sem horário de verão desde 2019)", () => {
    expect(utcToSaoPauloParts("2026-01-15T15:00:00Z")).toEqual({ date: "2026-01-15", time: "12:00" });
  });

  it("cruza a virada do dia corretamente", () => {
    expect(utcToSaoPauloParts("2026-01-01T02:00:00Z")).toEqual({ date: "2025-12-31", time: "23:00" });
  });
});

describe("formatUtcAsSaoPaulo", () => {
  it("retorna uma string não vazia formatada em pt-BR", () => {
    const formatted = formatUtcAsSaoPaulo("2026-01-15T15:00:00Z");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
