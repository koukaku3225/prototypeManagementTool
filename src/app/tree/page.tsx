import { redirect } from "next/navigation";

/**
 * ツリーは「場所」ではなく「ビュー」だったので、/goals の表示切替へ移した。
 * 古いリンク・ブックマークを拾うためのリダイレクト。
 */
export default function LegacyTree() {
  redirect("/goals?view=tree");
}
