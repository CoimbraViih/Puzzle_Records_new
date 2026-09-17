// proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessRoute, isUserRole, type UserRole } from "@/lib/auth/permissions";

export async function proxy(request: NextRequest) {
  // Cookies refreshed por supabase-ssr durante getUser()/a consulta de perfil
  // precisam sobreviver à resposta final ser reconstruída depois que sabemos
  // o papel do usuário, então acumulamos aqui (setAll pode ser chamado mais
  // de uma vez — getUser() e a query em "profiles" cada um pode disparar um
  // refresh de token) e reaplicamos em QUALQUER resposta que devolvermos,
  // inclusive redirects. Aplicar só em NextResponse.next() e não nos
  // redirects descartaria silenciosamente cookies de sessão revogados/
  // renovados exatamente nos caminhos mais comuns (usuário sem sessão válida
  // sendo mandado para /login, ou usuário sem permissão sendo mandado de
  // volta para /dashboard).
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          pendingCookies.push(...cookiesToSet);
        },
      },
    }
  );

  function withCookies<T extends NextResponse>(res: T): T {
    pendingCookies.forEach(({ name, value, options }) =>
      res.cookies.set(name, value, options)
    );
    return res;
  }

  function redirect(path: string) {
    return withCookies(NextResponse.redirect(new URL(path, request.url)));
  }

  // Construído SOB DEMANDA, a partir do request.headers atual (já refletindo
  // qualquer refresh de cookie que tenha acontecido até este ponto via
  // setAll() acima) — nunca de um snapshot tirado antes das chamadas ao
  // Supabase, ou o header forwardado ficaria dessincronizado da sessão
  // recém-renovada e app/dashboard/layout.tsx veria o usuário como deslogado.
  function next(role?: UserRole) {
    const headers = new Headers(request.headers);
    // Nunca confiar em "x-user-role" vindo do cliente: só é setado abaixo,
    // depois de resolvido a partir do banco.
    headers.delete("x-user-role");
    if (role) {
      headers.set("x-user-role", role);
    }
    return withCookies(NextResponse.next({ request: { headers } }));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/login/");
  const isDashboardRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  if (!user && isDashboardRoute) {
    return redirect("/login");
  }

  if (user && isAuthRoute) {
    return redirect("/dashboard");
  }

  if (user && isDashboardRoute) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (error) {
      // Falha transitória de rede/DB é indistinguível de "sem perfil" sem
      // isso — logamos para não virar uma indisponibilidade invisível.
      console.error("proxy: failed to fetch profile role", error);
    }

    const role = isUserRole(profile?.role) ? profile.role : undefined;

    // Se o pathname já é o "/dashboard" base, nunca redirecionamos para ele
    // mesmo (evita loop de redirecionamento quando o papel é desconhecido,
    // ex.: usuário criado antes da migração de profiles). Nesse caso deixamos
    // a requisição seguir e a própria página/layout do dashboard trata o
    // estado de "perfil não configurado".
    if (pathname === "/dashboard") {
      return next(role);
    }

    if (!role || !canAccessRoute(role, pathname)) {
      return redirect("/dashboard");
    }

    return next(role);
  }

  return next();
}

// IMPORTANTE — limite de confiança de segurança: app/dashboard/layout.tsx
// confia no header "x-user-role" setado acima em vez de sempre reconsultar o
// banco. Isso só é seguro porque o matcher abaixo garante que TODA rota sob
// /dashboard passa por este proxy antes de chegar ao layout. Se o matcher for
// estreitado, ou se uma Server Function/rota nova sob /dashboard passar a
// ficar fora dele, o header deixa de ser confiável e vira uma via de escalada
// de privilégio. Nunca reduza a cobertura do matcher sobre /dashboard sem
// também revisar app/dashboard/layout.tsx.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
