import { describe, it, expect } from "vitest";
import { buildCaptionUserPrompt, buildCaptionMessages } from "./prompt";

describe("buildCaptionUserPrompt", () => {
  it("inclui título e autor quando presentes", () => {
    const prompt = buildCaptionUserPrompt({ title: "flagra no show", author: "@fã123", origin: "telegram" });
    expect(prompt).toContain("flagra no show");
    expect(prompt).toContain("@fã123");
    expect(prompt).toContain("Telegram");
  });

  it("indica ausência de título/autor sem inventar nada", () => {
    const prompt = buildCaptionUserPrompt({ title: null, author: null, origin: "drive" });
    expect(prompt).toContain("Nenhum título ou gancho foi enviado");
    expect(prompt).toContain("Autor do envio não identificado");
    expect(prompt).toContain("Google Drive");
  });
});

describe("buildCaptionMessages", () => {
  it("retorna mensagem system + user, nessa ordem", () => {
    const messages = buildCaptionMessages({ title: "x", author: "y", origin: "drive" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("o system prompt instrui a não inventar fatos sobre pessoas reais", () => {
    const [system] = buildCaptionMessages({ title: null, author: null, origin: "drive" });
    expect(system.content.toLowerCase()).toContain("nunca invente fatos");
  });
});
