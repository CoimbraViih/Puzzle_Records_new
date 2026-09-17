import { describe, it, expect } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

describe("isAuthorizedCronRequest", () => {
  it("aceita quando o Authorization bate com CRON_SECRET", () => {
    expect(isAuthorizedCronRequest("Bearer abc123", "abc123")).toBe(true);
  });

  it("rejeita header ausente", () => {
    expect(isAuthorizedCronRequest(null, "abc123")).toBe(false);
  });

  it("rejeita secret errado", () => {
    expect(isAuthorizedCronRequest("Bearer errado", "abc123")).toBe(false);
  });
});
