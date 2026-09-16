import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import type { UserRole } from "@/lib/auth/permissions";

function isUserRole(value: string | undefined | null): value is UserRole {
  return value === "operador" || value === "aprovador" || value === "gestor";
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy.ts já resolveu o papel do usuário e o repassa via header para
  // evitar uma segunda chamada de getUser()+profiles nesta camada
  // (ver Finding 5 da revisão final). Se o header não estiver presente
  // (ex.: navegação direta em cenários não cobertos pelo proxy), caímos de
  // volta para a busca própria.
  const headerRole = (await headers()).get("x-user-role");

  let email = "";
  let role: UserRole | undefined;

  if (isUserRole(headerRole)) {
    role = headerRole;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }
    email = user.email ?? "";
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/login");
    }

    email = user.email ?? "";

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (error) {
      // Falha transitória de rede/DB é indistinguível de "sem perfil" sem
      // isso — logamos para não virar uma indisponibilidade invisível.
      console.error("DashboardLayout: failed to fetch profile role", error);
    }

    // Fail-closed: um usuário sem profile legível NÃO herda um papel padrão.
    // Nesse caso `role` permanece `undefined` e a página exibe o estado de
    // "perfil não configurado".
    role = isUserRole(profile?.role) ? profile.role : undefined;
  }

  if (!role) {
    return (
      <div className="flex min-h-screen flex-col">
        <Topbar email={email} />
        <div className="flex flex-1 flex-col items-center justify-center text-center p-6">
          <h1 className="text-xl font-semibold">Perfil não configurado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Contate um administrador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} />
      <div className="flex-1">
        <Topbar email={email} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
