"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * ブラウザ用クライアント。呼ぶたびに新規作成せず、モジュール内で使い回す。
 * anon key は公開してよい値（RLSが実際の境界）。
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
  }
  return client;
}
