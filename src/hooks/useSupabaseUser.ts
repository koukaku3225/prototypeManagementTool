"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { setSyncUser } from "@/lib/supabase/sync";

/**
 * いまのログイン状態。呼ぶたびに購読を1本張るので、
 * 画面をまたいで何箇所で使っても構わない（Supabase-js 側が軽量に扱う）。
 *
 * setSyncUser() をここで呼ぶことで、「ログインしていれば同期する」を
 * 1箇所（layout に置く SyncBoot）で成立させている。
 */
export function useSupabaseUser() {
  const [state, setState] = useState<{
    userId: string | null;
    email: string | null;
    loading: boolean;
  }>({ userId: null, email: null, loading: true });

  useEffect(() => {
    const supabase = supabaseBrowser();
    let alive = true;

    supabase.auth.getUser().then((res: Awaited<ReturnType<typeof supabase.auth.getUser>>) => {
      if (!alive) return;
      const userId = res.data.user?.id ?? null;
      setState({ userId, email: res.data.user?.email ?? null, loading: false });
      setSyncUser(userId);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      const userId = session?.user?.id ?? null;
      setState({ userId, email: session?.user?.email ?? null, loading: false });
      setSyncUser(userId);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
