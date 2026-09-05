import { redirect } from "next/navigation";

/**
 * 入口。開いたら時間割（カレンダー）を出す。
 *
 * このアプリは「先に時間を押さえる」道具なので、最初に見たいのは
 * 一覧ではなく時間の並びのほう。タスクリストは /list に置いてあり、
 * 時間割の「リスト」ボタンから行ける。
 *
 * ここを素通しのリダイレクトにしてあるのは、ブックマークや
 * router.push("/") が既にあちこちにあるため。入口の URL は変えない。
 */
export default function Index() {
  redirect("/plan");
}
