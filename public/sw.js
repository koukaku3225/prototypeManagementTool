/*
 * 目標設定コーチのサービスワーカー。
 *
 * 目的は2つだけ。
 *   1. スマホに「アプリとして」入れられるようにする（インストールの条件）
 *   2. 電波が無いときも、最後に開いた画面を出す（データは localStorage にあるので、
 *      画面さえ出れば時間割は見られるし、書ける）
 *
 * ■ 触らないもの（ここを広げると事故になる）
 *   - /api/・/auth/・/oauth/ … 対話・同期・ログイン。古い応答を返すと壊れる
 *   - 別のドメイン（Supabase・Google・フォント）… ブラウザにそのまま任せる
 *   - 画面遷移時のデータ取得（RSC）… 通常の fetch なので触らない
 *
 * ■ 画面は「まずネットから」
 *   キャッシュを先に返すと、デプロイ後も古い画面が出続ける。
 *   ネットから取れなかったときだけキャッシュを使う。
 *   /_next/static/ はファイル名に内容のハッシュが入っていて中身が変わらないので、
 *   こちらはキャッシュを先に使ってよい。
 *
 * 形を変えたら CACHE の版を上げる。古い版は activate で消える。
 */
const CACHE = "gc-pwa-v1";
const BYPASS = /^\/(api|auth|oauth)(\/|$)/;

self.addEventListener("install", () => {
  // 新しい版を待たせない（古い版が画面を握り続けないように）
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.test(url.pathname)) return;

  // 中身が変わらない静的ファイル：キャッシュを先に
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 画面そのもの：ネットを先に、だめならキャッシュ
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
  }
  // それ以外はブラウザに任せる（respondWith しない）
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    // 正常な画面だけ覚える（エラー画面やリダイレクトを覚えると、それが出続ける）
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await cache.match("/"));
    if (hit) return hit;
    throw err;
  }
}
