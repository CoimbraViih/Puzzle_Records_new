import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Não são código deste projeto: árvore de configuração/skills local do
    // Claude Code, scratch workspace do subagent-driven-development e clone
    // de referência externo do SDK do OpenRouter (repo próprio, não é código
    // do app — ver tsconfig.json/vitest.config.ts, mesma exclusão).
    ".claude/**",
    ".superpowers/**",
    "typescript-sdk/**",
  ]),
]);

export default eslintConfig;
