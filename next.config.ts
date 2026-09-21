import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions limitam o corpo a 1MB por padrão. O botão "Criar
      // post" do Kanban (app/dashboard/kanban/actions.ts) faz upload de
      // vídeo/foto direto via Server Action. 100mb é o teto absoluto de
      // corpo de requisição da própria Vercel Functions — não adianta
      // configurar mais que isso, a plataforma rejeitaria antes de chegar
      // aqui. Um vídeo real acima disso precisa ser comprimido/cortado antes
      // do upload (ou, no futuro, trocar para upload direto ao Supabase
      // Storage via signed URL, que não passa por este limite).
      bodySizeLimit: "100mb",
    },
    // proxy.ts (Next.js 16 renomeou middleware.ts) faz buffer do corpo da
    // requisição em memória para permitir múltiplas leituras — com um limite
    // PRÓPRIO e SEPARADO do serverActions.bodySizeLimit acima, default 10MB.
    // Como proxy.ts roda em toda rota (inclusive as Server Actions do
    // Kanban), um upload de vídeo real estourava esse teto antes mesmo de
    // chegar no bodySizeLimit: o corpo era truncado nos primeiros 10MB,
    // cortando o multipart no meio e quebrando o parser com "Unexpected end
    // of form" (bug real reproduzido em produção e localmente — a doc oficial
    // deste ajuste está em
    // node_modules/next/dist/docs/.../proxyClientMaxBodySize.md, nome novo
    // desta versão do Next; o nome antigo "middlewareClientMaxBodySize" que
    // aparece na mensagem de aviso do próprio Next.js está desatualizado).
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
