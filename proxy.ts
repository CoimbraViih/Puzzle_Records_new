// proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessRoute, type UserRole } from "@/lib/auth/permissions";

export async function proxy(request: NextRequest) {
  // requestHeaders is forwarded to downstream Server Components (see
  // NextResponse.next({ request: { headers } })). We use it to pass the
  // already-resolved role via "x-user-role" so app/dashboard/layout.tsx can
  // skip its own duplicate getUser()+profile fetch (Finding 5).
  const requestHeaders = new Headers(request.headers);
  // Nunca confiar em "x-user-role" vindo do cliente: só é setado abaixo,
  // depois de resolvido a partir do banco.
  requestHeaders.delete("x-user-role");

  // Cookies refreshed by supabase-ssr during getUser()/profile calls need to
  // survive the response object being rebuilt after we know the role, so we
  // collect them here and re-apply them on whichever response we end up
  // returning instead of mutating a response we later discard.
  let pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

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
          pendingCookies = cookiesToSet;
        },
      },
    }
  );

  function buildResponse(init?: Parameters<typeof NextResponse.next>[0]) {
    const res = NextResponse.next(init ?? { request: { headers: requestHeaders } });
    pendingCookies.forEach(({ name, value, options }) =>
      res.cookies.set(name, value, options)
    );
    return res;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  if (!user && isDashboardRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (user && isDashboardRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role as UserRole | undefined;

    if (role) {
      requestHeaders.set("x-user-role", role);
    }

    // Se o pathname já é o "/dashboard" base, nunca redirecionamos para ele
    // mesmo (evita loop de redirecionamento quando o papel é desconhecido,
    // ex.: usuário criado antes da migração de profiles). Nesse caso deixamos
    // a requisição seguir e a própria página/layout do dashboard trata o
    // estado de "perfil não configurado".
    if (pathname === "/dashboard") {
      return buildResponse();
    }

    if (!role || !canAccessRoute(role, pathname)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return buildResponse();
  }

  return buildResponse();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
