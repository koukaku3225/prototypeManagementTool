import { redirect } from "next/navigation";

/** ホームは "/" に移した。古いリンクを拾うためのリダイレクト。 */
export default function LegacyHome() {
  redirect("/");
}
