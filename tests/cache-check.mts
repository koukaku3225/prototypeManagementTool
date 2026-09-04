/**
 * プロンプトキャッシュが実際に効いているかを、実APIを叩いて確かめる。
 *
 * 単体テストでは検証できない。境界の置き方が正しいかどうかは
 * サーバが返す usage を見るまで分からず、置き場所を間違えても
 * エラーにはならず「静かに効かない」だけだから。
 *
 *   npx tsx --env-file=.env.local tests/cache-check.mts
 *
 * 実際に課金される（haiku で数円）。CI では回さないこと。
 *
 * ■ 実測したキャッシュ最小長（claude-haiku-4-5）
 *   合計 1334 / 2104 / 3314 トークン … 書き込み 0。まったく効かない
 *   合計 4194 トークン              … 書き込み 4183、次の呼び出しで全量読み出し
 *   つまり閾値は 4096 トークン。これを下回るプロンプトでは cache_control が
 *   無視される。エラーは出ない。だから「書いたのに効いていない」に気づけない。
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSystem,
  toCachedMessages,
  type ChatRequest,
} from "../src/lib/chat-prompt";
import { CHAT_MODEL } from "../src/lib/anthropic";

const client = new Anthropic();

const base: Omit<ChatRequest, "messages" | "turnsInPhase"> = {
  mode: "small",
  coachId: "kaede",
  phase: "diverge",
  profile: {
    updatedAt: new Date().toISOString(),
    lifePatterns: ["平日は22時帰宅", "朝が弱い"],
    pastFailures: ["3日坊主になりがち"],
    valuesAccumulated: ["健康", "自由"],
    communicationStyle: { avgResponseLength: 40, prefersConcrete: true },
  },
  bigStory: {
    id: "t",
    createdAt: "",
    updatedAt: "",
    coachId: "kaede",
    horizonYears: 5,
    vision: { raw: "健康な体で裁量のある仕事をしている", refined: "" },
    values: ["健康", "貢献", "自由"],
    currentPosition: "受託中心の在宅勤務。副業は試作段階",
    milestones: [{ label: "3年後", state: "月3万円" }],
    editedFields: [],
  },
  commitmentStep: false,
};

type Msg = { role: "user" | "assistant"; content: string };

const USER_LINES = [
  "副業でアプリを作っているのですが、続ける仕組みが作れていません。平日は本業で消耗していて、帰宅したあとに机に向かう気力が残っていないことが多いです。",
  "平日の夜です。帰宅すると疲れて手が止まります。エディタを開くまでに一時間くらいスマホを見てしまうこともあります。",
  "前の日に「次はここをやる」と決めてあった日は始められています。決めていない日は、何から手をつけるか考えているうちに時間が過ぎます。",
  "「この画面のこのボタンを押したときの処理を書く」くらいまで細かく決めてあると動けます。粒度が荒いと億劫になります。",
  "土日はできています。まとめて4時間くらい。ただ平日に考えていたことを忘れていて、思い出すところからになります。",
  "作っているものが人に使われている実感が持てると続くのだと思います。いまは自分だけが使っている状態です。",
  "半年後には、自分以外の誰かが週に一度は開いてくれている状態にしたいです。人数は多くなくてよくて、3人くらいでも。",
  "そのためには、まず人に見せられる状態まで持っていく必要があります。いまは自分にしか分からない画面が残っています。",
];

const COACH_LINES = [
  "続かないと感じるのは、どんな場面でしょうか。",
  "始めてしまえば集中できる、というのは大きな手がかりですね。始められた日は、何が違いましたか。",
  "決めてあると始められる。その決め方は、どのくらいの粒度でしたか。",
  "週末はいかがですか。",
  "思い出すところから、というのはもったいないですね。何が続く支えになりそうですか。",
  "使われている実感、という言葉が出ましたね。それはどんな状態でしょうか。",
  "3人が週に一度開いている。そこに近づくには、何が要りますか。",
];

/** 実際の対話に近い長さの履歴を作る。turns 回のやり取りを積む */
function buildHistory(turns: number): Msg[] {
  const msgs: Msg[] = [{ role: "user", content: "（対話を始めてください）" }];
  for (let i = 0; i < turns; i++) {
    msgs.push({
      role: "assistant",
      content: COACH_LINES[i % COACH_LINES.length],
    });
    msgs.push({ role: "user", content: USER_LINES[i % USER_LINES.length] });
  }
  return msgs;
}

async function turn(label: string, messages: Msg[]) {
  const body: ChatRequest = { ...base, messages, turnsInPhase: 2 };
  const res = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: buildSystem(body),
    messages: toCachedMessages(messages),
  });

  const u = res.usage;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const total = u.input_tokens + read + write;

  console.log(
    [
      label.padEnd(14),
      `合計 ${String(total).padStart(5)}`,
      `定価 ${String(u.input_tokens).padStart(5)}`,
      `読 ${String(read).padStart(5)}`,
      `書 ${String(write).padStart(5)}`,
      `命中率 ${String(total ? Math.round((read / total) * 100) : 0).padStart(3)}%`,
    ].join("  "),
  );
  return { read, write, input: u.input_tokens, total };
}

// 対話が進むほどキャッシュが効いてくることを見る。
// 序盤（4096トークン未満）では効かないのが正常。
const short = await turn("序盤(3往復)", buildHistory(3));
const grown = await turn("中盤(8往復)", buildHistory(8));
const next = await turn("その次のターン", [
  ...buildHistory(8),
  { role: "assistant", content: "そこに近づくために、まず何から手をつけますか。" },
  { role: "user", content: "自分にしか分からない画面に、説明を1行ずつ足すところからです。" },
]);

console.log("");
console.log(`序盤: 合計 ${short.total} トークン → 閾値 4096 未満なら効かないのが正常`);

if (next.read > 0) {
  const savedRate = Math.round((next.read / next.total) * 100);
  console.log(
    `OK: 履歴が育つとキャッシュが効く。直近ターンは入力の ${savedRate}% を` +
      ` キャッシュから読めた（${next.read} トークン、定価の1/10）`,
  );
} else {
  console.log("NG: 履歴が育ってもキャッシュが効かない。境界の位置を疑うこと");
  process.exitCode = 1;
}
