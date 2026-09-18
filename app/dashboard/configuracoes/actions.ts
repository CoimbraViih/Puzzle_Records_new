"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUserRole, type UserRole } from "@/lib/auth/permissions";
import { createApiKey, revokeApiKey } from "@/lib/api-keys/api-keys";
import { testConnection, type ConnectionTestResult, type TestableIntegrationKey } from "@/lib/connections/status";

/**
 * Defesa em profundidade: /dashboard/configuracoes já é bloqueada para
 * não-admin em lib/auth/permissions.ts (aplicada no proxy.ts), mas Server
 * Actions podem ser invocadas diretamente (POST ao endpoint da action) sem
 * passar pela navegação de página — então repetimos a checagem de papel
 * aqui, fail-closed, mesmo padrão de app/dashboard/layout.tsx.
 */
async function requireAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("não autenticado");

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (error) throw new Error("falha ao verificar permissão");

  const role: UserRole | undefined = isUserRole(profile?.role) ? profile.role : undefined;
  if (role !== "admin") throw new Error("acesso restrito a administradores");

  return { userId: user.id };
}

export async function testConnectionAction(key: TestableIntegrationKey): Promise<ConnectionTestResult> {
  await requireAdmin();
  return testConnection(key);
}

export interface CreateApiKeyState {
  error: string | null;
  plaintext: string | null;
  name: string | null;
}

export async function createApiKeyAction(_prevState: CreateApiKeyState, formData: FormData): Promise<CreateApiKeyState> {
  const { userId } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Dê um nome para identificar a chave.", plaintext: null, name: null };
  }

  const { plaintext } = await createApiKey({ name, createdBy: userId });
  revalidatePath("/dashboard/configuracoes");
  return { error: null, plaintext, name };
}

export interface RevokeApiKeyState {
  error: string | null;
}

export async function revokeApiKeyAction(_prevState: RevokeApiKeyState, formData: FormData): Promise<RevokeApiKeyState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id da chave ausente" };

  await revokeApiKey(id);
  revalidatePath("/dashboard/configuracoes");
  return { error: null };
}
