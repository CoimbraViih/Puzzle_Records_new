export function isAuthorizedCronRequest(authorizationHeader: string | null, expectedSecret: string): boolean {
  if (!authorizationHeader) return false;
  return authorizationHeader === `Bearer ${expectedSecret}`;
}

/**
 * Lê uma env var obrigatória e falha alto (throw) se ela estiver ausente, em
 * vez de deixar o valor faltante virar "undefined" silenciosamente em
 * comparações/URLs — o que abriria brechas de autenticação fail-open.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
