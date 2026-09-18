import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    env: {
      // Alguns módulos importados transitivamente pelos testes de ingestão
      // (workers/queues.ts -> workers/connection.ts) exigem REDIS_URL só
      // para instanciar o client no import — nenhum teste hoje exercita a
      // fila de fato (sem chamada de rede), então um valor fictício basta.
      REDIS_URL: "redis://localhost:6379",
    },
    include: ["**/*.test.ts"],
    exclude: [
      "node_modules/**",
      ".next/**",
      ".claude/**",
      ".superpowers/**",
    ],
  },
});
