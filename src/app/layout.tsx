import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { LocalBackupBoot } from "@/components/LocalBackupBoot";
import { StorageAlert } from "@/components/StorageAlert";
import { SyncBoot } from "@/components/SyncBoot";
import "./globals.css";

export const metadata: Metadata = {
  title: "目標設定コーチ",
  description:
    "AIとの対話で、なりたい姿を明日の一歩に変える。目標設定と自己分析のためのプロトタイプ。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        {/*
          next/font は日本語サブセットをビルド時に全件ダウンロードしようとして
          失敗するため、ブラウザ側で読み込む。
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Zen+Old+Mincho:wght@400;700;900&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <SyncBoot />
        {/*
          ログイン状態に関係なく常時効く、ディスクへのバックアップと
          空っぽ起動時の復元案内。StorageAlert より先に置く必要はないが、
          両方が同時に出ても崩れないようにしてある
        */}
        <LocalBackupBoot />
        {/* 保存できていないことは、どの画面にいても知らせる必要がある */}
        <StorageAlert />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
