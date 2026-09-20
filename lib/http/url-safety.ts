import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([range, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(range) & mask);
  });
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped) return isPrivateIpv4(ipv4Mapped[1]);
  return false;
}

/**
 * Guard contra SSRF para URLs de mídia fornecidas por terceiros (ex.:
 * `mediaUrl` do webhook do n8n, baixada server-side pelo próprio app).
 * Resolve o hostname via DNS e rejeita qualquer endereço privado/loopback/
 * link-local — sem isso, uma automação (ou uma chave de API vazada) poderia
 * usar o endpoint para fazer o servidor da Vercel fazer requisições contra
 * infraestrutura interna. Não elimina TOCTOU de DNS rebinding entre esta
 * checagem e o `fetch` seguinte, mas cobre o caso comum de URL apontando
 * direto para um IP/hostname interno.
 */
export async function assertPublicHttpsUrl(value: string): Promise<void> {
  if (!isHttpsUrl(value)) {
    throw new Error("URL precisa ser https");
  }
  const { hostname } = new URL(value);

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    const isPrivate = literalFamily === 4 ? isPrivateIpv4(hostname) : isPrivateIpv6(hostname);
    if (isPrivate) throw new Error(`URL aponta para um endereço privado/reservado (${hostname})`);
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
    if (isPrivate) throw new Error(`URL resolve para um endereço privado/reservado (${address})`);
  }
}
