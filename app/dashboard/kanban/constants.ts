// Compartilhado entre app/dashboard/kanban/actions.ts (Server Action) e
// create-post-form.tsx (client, valida antes de enviar). Não pode viver
// dentro de actions.ts: um arquivo "use server" só pode exportar funções
// async — exportar uma constante numérica de lá quebra o build com
// `A "use server" file can only export async functions, found number.`
//
// O teto real não é a Vercel (100MB, ver next.config.ts) — é o próprio
// Supabase Storage: o projeto real recusa qualquer objeto acima de 50MB
// ("The object exceeded the maximum allowed size"), confirmado empiricamente
// subindo arquivos de teste diretamente via API (50MB passou, 51MB falhou).
// Esse teto é do plano do projeto Supabase, não configurável por bucket nem
// por esta MCP — só upgrade de plano + ajuste em Project Settings > Storage
// no dashboard do Supabase aumentaria isso. Usar aqui o valor real evita
// deixar o usuário subir um arquivo que o Next.js aceita mas o Supabase vai
// rejeitar de qualquer forma.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
