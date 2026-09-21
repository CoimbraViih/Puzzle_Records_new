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
  },
};

export default nextConfig;
