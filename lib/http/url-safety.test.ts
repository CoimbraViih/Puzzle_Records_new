import { describe, it, expect } from "vitest";
import { isHttpsUrl, assertPublicHttpsUrl } from "./url-safety";

describe("isHttpsUrl", () => {
  it("aceita URL https", () => {
    expect(isHttpsUrl("https://example.com/video.mp4")).toBe(true);
  });

  it("rejeita esquemas perigosos", () => {
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("data:text/html,<script>")).toBe(false);
    expect(isHttpsUrl("http://example.com")).toBe(false);
  });

  it("rejeita string que não é uma URL válida", () => {
    expect(isHttpsUrl("não é uma url")).toBe(false);
  });
});

describe("assertPublicHttpsUrl", () => {
  it("rejeita esquema não-https", async () => {
    await expect(assertPublicHttpsUrl("http://8.8.8.8/a.jpg")).rejects.toThrow("https");
  });

  it("rejeita IPv4 literal privado/reservado (loopback, RFC1918, link-local)", async () => {
    await expect(assertPublicHttpsUrl("https://127.0.0.1/a.jpg")).rejects.toThrow(/privado|reservado/);
    await expect(assertPublicHttpsUrl("https://10.0.0.5/a.jpg")).rejects.toThrow(/privado|reservado/);
    await expect(assertPublicHttpsUrl("https://192.168.1.1/a.jpg")).rejects.toThrow(/privado|reservado/);
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /privado|reservado/,
    );
  });

  it("rejeita IPv6 literal privado/reservado (loopback, unique-local, link-local)", async () => {
    await expect(assertPublicHttpsUrl("https://[::1]/a.jpg")).rejects.toThrow(/privado|reservado/);
    await expect(assertPublicHttpsUrl("https://[fd00::1]/a.jpg")).rejects.toThrow(/privado|reservado/);
    await expect(assertPublicHttpsUrl("https://[fe80::1]/a.jpg")).rejects.toThrow(/privado|reservado/);
  });

  it("aceita IPv4 literal público", async () => {
    await expect(assertPublicHttpsUrl("https://8.8.8.8/a.jpg")).resolves.toBeUndefined();
  });
});
