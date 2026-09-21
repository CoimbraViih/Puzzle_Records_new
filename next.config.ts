import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions limitam o corpo a 1MB por padrão. O botão "Criar
      // post" do Kanban (app/dashboard/kanban/actions.ts) faz upload de
      // vídeo/foto direto via Server Action, com o mesmo teto de 50MB usado
      // no webhook do n8n — aumentado aqui com folga para o overhead do
      // multipart/form-data (boundaries, headers de cada parte).
      bodySizeLimit: "52mb",
    },
  },
};

export default nextConfig;
