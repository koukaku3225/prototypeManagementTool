import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー用クライアント（API Route / Server Component から使う）。
 * Cookie に載ったセッションを読むだけで、書き込みは行わない
 * （Route Handler からの set は Next.js 側で保証されないため、
 * セッションの更新は middleware に任せる）。
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* Server Component からは呼ばれうる。middleware が更新するので無視してよい */
          }
        },
      },
    },
  );
}
