export function isAuthorizedCronRequest(authorizationHeader: string | null, expectedSecret: string): boolean {
  if (!authorizationHeader) return false;
  return authorizationHeader === `Bearer ${expectedSecret}`;
}
