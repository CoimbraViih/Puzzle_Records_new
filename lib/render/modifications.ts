export interface CaptionForRender {
  headline: string;
  body: string;
}

export interface RenderMediaUrls {
  photo1Url: string;
  photo2Url?: string;
}

/**
 * Nomes de camada configuráveis via env var em vez de hardcoded, porque o
 * template do Creatomate ainda não existe — quando o usuário desenhar o
 * template de verdade, os nomes reais entram só na env, sem mexer no código.
 * MVP simplificado: quando só há uma foto disponível, a segunda camada de
 * foto reusa a mesma URL (o material bruto da Fase 1 ainda é um único
 * arquivo por item — "foto dupla" de verdade fica para quando o pipeline
 * suportar múltiplos arquivos por item).
 */
export function buildCreatomateModifications(caption: CaptionForRender, media: RenderMediaUrls): Record<string, string> {
  const modifications: Record<string, string> = {};

  const headlineLayer = process.env.CREATOMATE_LAYER_HEADLINE;
  const photo1Layer = process.env.CREATOMATE_LAYER_PHOTO_1;
  const photo2Layer = process.env.CREATOMATE_LAYER_PHOTO_2;
  const badgeLayer = process.env.CREATOMATE_LAYER_BADGE;

  if (headlineLayer) modifications[headlineLayer] = caption.headline;
  if (photo1Layer) modifications[photo1Layer] = media.photo1Url;
  if (photo2Layer) modifications[photo2Layer] = media.photo2Url ?? media.photo1Url;
  if (badgeLayer) modifications[badgeLayer] = "AGORA";

  return modifications;
}
