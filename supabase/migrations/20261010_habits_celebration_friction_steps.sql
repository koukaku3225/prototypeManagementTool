-- 習慣の「祝い」「始めるまでの手順数」(D1・D4)。
-- Supabase プロジェクト jvtfxrzpqtlqukxtftjn に apply_migration 済み（2026-10-10）。
-- 追加のみ・NULL可・既定値あり。既存行は NULL のまま（アプリは null を未設定として扱う）。
alter table public.habits add column if not exists celebration text default null;
alter table public.habits add column if not exists friction_steps smallint default null;
comment on column public.habits.celebration is 'やったあとの祝い（任意の一言・しぐさ）';
comment on column public.habits.friction_steps is '始めるまでの手順数 0〜4（4は4以上）。未回答はNULL';
