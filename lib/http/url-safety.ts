/**
 * Valida que uma string é uma URL https absoluta.
 *
 * Usado na fronteira de escrita (webhook do Creatomate) antes de persistir
 * `render_url`: a coluna é renderizada como `href` no Kanban e passada direto
 * para `client.publish({ videoUrl })`, então um esquema como `javascript:` ou
 * `data:` chegando por ali seria um vetor real. Bloquear na escrita garante
 * que o dado guardado nunca contém um esquema perigoso.
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
