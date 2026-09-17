// Roda um render de teste contra o CREATOMATE_TEMPLATE_ID configurado, para
// validar uma troca de versão de template antes de ir para produção (regra
// do CLAUDE.md: "nunca trocar a versão em produção sem rodar o smoke test
// automático primeiro"). Uso: npm run creatomate:smoke-test
import "dotenv/config";
import { startCreatomateRender } from "../lib/render/creatomate-client";
import { buildCreatomateModifications } from "../lib/render/modifications";

async function main() {
  const modifications = buildCreatomateModifications(
    { headline: "SMOKE TEST — ignorar", body: "Render de validação automática do template." },
    { photo1Url: "https://placehold.co/1080x1920.png" },
  );

  const render = await startCreatomateRender(modifications, "https://example.com/smoke-test-no-webhook");

  console.log(`[smoke-test] render iniciado: id=${render.id} status=${render.status}`);
  if (!render.id) {
    console.error("[smoke-test] FALHOU — resposta sem id de render");
    process.exit(1);
  }
  console.log("[smoke-test] OK — template aceitou o payload. Confira o resultado no dashboard do Creatomate.");
}

main().catch((err) => {
  console.error("[smoke-test] FALHOU:", err);
  process.exit(1);
});
