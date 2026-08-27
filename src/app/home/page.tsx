import { redirect } from "next/navigation";

/** ホームは "/"（今日）に移した。古いリンクを拾うためのリダイレクト。 */
export default function LegacyHome() {
  redirect("/");
}
