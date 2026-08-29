import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * セッションCookieの更新だけを行う。
 *
 * @supabase/ssr は「アクセストークンの期限が切れたら自動で更新する」ために
 * これが動いていることを前提にしている。無いと、ブラウザは古いトークンを
 * 持ち続けてある日突然サインアウト扱いになる（実際に踏むまで気づかない種類の不具合）。
 * ここではリダイレクトなどの認可判断はしない。未ログインの扱いは各画面側で行う。
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 呼ぶだけでよい。中身は使わない（トークン更新のための呼び出し）
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的ファイルと画像最適化には要らない。
     * それ以外の全ルートで通す（API Route も含む。/api/chat 側でセッションを見るため）。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
