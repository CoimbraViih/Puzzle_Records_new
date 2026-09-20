import { timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante (independente do tamanho/conteúdo
 * das strings, desde que os buffers tenham o mesmo comprimento — daí o check
 * de `length` antes, que é seguro pois o comprimento em si não é segredo).
 * Usar em todo lugar que compara um token/segredo vindo de uma requisição
 * (header, query string) com um valor esperado, para não vazar informação por
 * timing side-channel.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
