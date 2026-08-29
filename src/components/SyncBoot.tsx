"use client";

import { useSupabaseUser } from "@/hooks/useSupabaseUser";

/**
 * layout.tsx に1つだけ置く。画面には何も出さない。
 * ログイン状態を見て、以後の localStorage 書き込みを裏でSupabaseへ
 * 同期する状態にする（setSyncUser 経由）。ログインしていなければ何もしない。
 */
export function SyncBoot() {
  useSupabaseUser();
  return null;
}
