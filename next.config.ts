import type { NextConfig } from "next";

/**
 * セキュリティヘッダ。
 *
 * いま実在する XSS 経路はゼロだが、localStorage に対話全文・過去の挫折・
 * 価値観を平文で持っている以上、1つでも生えたときの被害が大きい。
 * CSP はその保険で、connect-src を絞ってあると盗んでも外へ出せない。
 *
 * X-Frame-Options は保険ではなく、いま効く。これが無いと攻撃者のページが
 * このアプリを透明な iframe で重ね、設定画面の「すべて消してやり直す」を
 * クリックさせられる（確認ダイアログはあるが、2クリック誘導は現実的）。
 */
/**
 * 開発モードだけ緩める必要がある。
 * - React は development ビルドでスタックトレース復元に eval() を使う
 *   （production では使わない）
 * - HMR が ws://localhost へ繋ぐので connect-src 'self' では落ちる
 * ここを本番と同じにすると、開発中ずっとHMRが死んで気づかない。
 */
const isDev = process.env.NODE_ENV === "development";

/** Supabase の REST/Realtime 呼び出し先。URLから origin だけ取り出す */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

const csp = [
  "default-src 'self'",
  // Next.js のブートストラップがインラインスクリプトを使うため現状は必要。
  // nonce 化するのが理想だが、それは CSP を本格導入するときにまとめてやる
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Google Fonts をCDNから読んでいる。セルフホストすれば 'self' だけに絞れる
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  /**
   * ここが要。盗まれても外部へ送れない。dev だけ HMR のWebSocketを許す。
   * Supabase の URL だけ例外で足す（自分のDBなので、盗まれた先ではない）。
   * NEXT_PUBLIC_SUPABASE_URL が無いビルドでは Supabase 呼び出し自体が
   * 落ちるので、その場合は 'self' のみのままにする。
   */
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
