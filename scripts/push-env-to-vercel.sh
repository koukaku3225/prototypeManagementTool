#!/usr/bin/env bash
#
# .env.local の値を、そのまま Vercel の環境変数へ送る。
#
# なぜこれが要るか:
#   Vercel の管理画面で秘密の値を手で貼り付けるのは、
#   ・貼り間違い／改行の混入で壊れる（実際に壊れて /api/chat が全滅した）
#   ・スコープ（Production / Preview）の付け忘れが起きる
#     （本番だけに入れてプレビューが500になる、を実際に踏んだ）
#   という2つの事故を起こしやすい。
#   ここは .env.local を唯一の正として、機械的に流し込む。
#
# 使い方:
#   1) vercel login          # 初回だけ。ブラウザが開く
#   2) vercel link           # 初回だけ。このディレクトリをプロジェクトに紐づける
#   3) bash scripts/push-env-to-vercel.sh              # 確認だけ（何も変更しない）
#   4) bash scripts/push-env-to-vercel.sh --apply      # 実際に反映する
#
# 対象の環境は production と preview の両方。
# development は各自の .env.local がそのまま効くので触らない。

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
APPLY="no"
[ "${1:-}" = "--apply" ] && APPLY="yes"

if [ ! -f "$ENV_FILE" ]; then
  echo "エラー: $ENV_FILE が見つかりません。" >&2
  exit 1
fi

# 送る変数。ここに無いものは触らない（GOOGLE_OAUTH_* はSupabase側に登録済みで、
# アプリ自身は読まないため対象外）
VARS="ANTHROPIC_API_KEY NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN"
TARGETS="production preview"

# .env.local から値を1つ取り出す。前後の空白と引用符を落とす
read_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/'
}

if [ "$APPLY" = "no" ]; then
  echo "=== 確認のみ（--apply を付けると実際に反映します）==="
else
  echo "=== 反映します ==="
fi
echo

missing=0
for name in $VARS; do
  value="$(read_value "$name")"
  if [ -z "$value" ]; then
    echo "  ✗ $name : $ENV_FILE に値がありません"
    missing=1
    continue
  fi
  # 値そのものは出さない。長さと先頭・末尾だけで取り違えを見分ける
  len=${#value}
  head4="${value:0:4}"
  tail4="${value: -4}"
  echo "  ✓ $name : ${len}文字 (${head4}…${tail4})"
done

if [ "$missing" = "1" ]; then
  echo
  echo "値の足りない変数があります。中止しました。" >&2
  exit 1
fi

if [ "$APPLY" = "no" ]; then
  echo
  echo "問題なければ次を実行してください:"
  echo "  bash scripts/push-env-to-vercel.sh --apply"
  exit 0
fi

echo
for name in $VARS; do
  value="$(read_value "$name")"
  for target in $TARGETS; do
    # 既存があれば消す。無ければ失敗するが、それは想定内なので無視する
    vercel env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    # 改行を付けずに渡す。末尾の改行が値に混ざると、トークンとして無効になる
    printf '%s' "$value" | vercel env add "$name" "$target" >/dev/null
    echo "  → $name ($target) を設定しました"
  done
done

echo
echo "完了。反映するには再デプロイが必要です:"
echo "  vercel --prod"
echo "または GitHub に何かpushするか、Vercelの画面から「再デプロイ」を押してください。"
