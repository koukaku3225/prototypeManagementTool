/**
 * スマホアプリとして入れる（PWAのインストール）ための判断。
 *
 * ブラウザによって入れ方がまったく違う。
 *   - Android の Chrome / Edge、PC の Chrome … ブラウザが「インストール」の
 *     ダイアログを持っている。こちらのボタンからそれを呼べる（beforeinstallprompt）
 *   - iPhone / iPad … ページから呼ぶ手段が無い。共有ボタン →「ホーム画面に追加」を
 *     本人に押してもらうしかない。どのブラウザでも Safari と同じ入れ方になる
 *   - それ以外（Firefox など）… ブラウザのメニューから入れてもらう
 *
 * 画面側がこの分岐を持つと、ブラウザごとの細かい条件が UI に散らばる。
 * 判断はここに閉じ、tests/pwa.test.mjs で全通りを固定する。
 */

export type InstallMode =
  /** もうアプリとして開いている。何も出さない */
  | "installed"
  /** ボタン1つで入れられる（ブラウザのダイアログを呼べる） */
  | "prompt"
  /** iPhone / iPad。手順を案内する */
  | "ios"
  /** 呼べないブラウザ。メニューから入れる案内をする */
  | "manual";

export function installMode(i: {
  /** アプリとして（ホーム画面から）開いているか */
  standalone: boolean;
  /** ブラウザがインストールのダイアログを渡してくれたか */
  hasPrompt: boolean;
  userAgent: string;
  /** iPad は PC の Safari を名乗るので、指で触れるかで見分ける */
  maxTouchPoints: number;
}): InstallMode {
  if (i.standalone) return "installed";
  if (isIOS(i.userAgent, i.maxTouchPoints)) return "ios";
  if (i.hasPrompt) return "prompt";
  return "manual";
}

/**
 * iPhone / iPad か。
 *
 * iPadOS 13 以降の Safari は「Macintosh」を名乗るので、UA だけでは見分けられない。
 * Mac は画面を指で触れないので、タッチ点があれば iPad とみなす。
 */
export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
