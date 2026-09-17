import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    { path: "/api/drive/poll", schedule: "*/5 * * * *" },
    { path: "/api/drive/renew-channel", schedule: "0 */6 * * *" },
  ],
};
