import type { MetadataRoute } from "next";

/**
 * スマホのホーム画面に「アプリとして」置くための名札。
 *
 * これと HTTPS とサービスワーカー（public/sw.js）が揃うと、
 * Android の Chrome はインストールを受け付ける。iPhone は
 * 共有 →「ホーム画面に追加」で入れる（layout.tsx の appleWebApp も見る）。
 *
 * 色は globals.css の --indigo と --paper（ライト）に合わせてある。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "目標設定コーチ",
    short_name: "目標コーチ",
    description: "AIとの対話で、なりたい姿を明日の一歩に変える",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f5f9",
    theme_color: "#2e4a7d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
