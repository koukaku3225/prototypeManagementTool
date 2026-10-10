-- 週のふりかえり（習慣タブ /habits/week）の一言を持つテーブル。
-- Supabase プロジェクト jvtfxrzpqtlqukxtftjn に apply_migration 済み（2026-10-10）。
-- 追加のみ（既存テーブルは変えない）。RLS と「自分の行だけ」のポリシーは habit_logs と同じ形。
create table if not exists public.weekly_reviews (
  user_id uuid not null default auth.uid() references auth.users(id),
  week_start date not null,
  good text not null default '',
  next_note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_reviews enable row level security;

drop policy if exists "own rows only" on public.weekly_reviews;
create policy "own rows only" on public.weekly_reviews
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.weekly_reviews is '週のふりかえりの一言。1週1行（月曜の日付）。';
comment on column public.weekly_reviews.week_start is 'その週の月曜（ローカル日付）';
comment on column public.weekly_reviews.good is 'うまくいったこと（任意）';
comment on column public.weekly_reviews.next_note is '来週の自分へ（任意）。次の週の「前回の自分から」に出る';
