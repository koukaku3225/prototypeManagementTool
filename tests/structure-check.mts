/**
 * 対話ログの整理を1回の呼び出しにまとめた変更（プロフィール相乗り）が
 * 本当に動くかを、実APIを叩いて確かめる。
 *
 *   npx tsx --env-file=.env.local tests/structure-check.mts
 *
 * 実際に課金される（sonnet で十数円）。CI では回さないこと。
 * 見るところは3つ。
 *   1. parsed_output が null にならないか（スキーマが大きくなったので）
 *   2. profile がちゃんと埋まるか（相乗りさせた項目）
 *   3. 出力トークンがどれだけ出ているか（ここがこのアプリの最大の支出）
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoalCardSchema } from "../src/lib/structure-schema";
import { STRUCTURE_EXTRACTION_PROMPT } from "../src/lib/prompts/extraction";
import { STRUCTURE_MODEL } from "../src/lib/anthropic";

const client = new Anthropic();

const transcript = `対話日: ${new Date().toISOString().slice(0, 10)}

[理想の姿] カエデ: はじめまして。いま気になっていることを聞かせてください。
[理想の姿] ユーザー: 副業でアプリを作っているのですが、続ける仕組みが作れていません。平日は本業で消耗していて、帰宅したあとに机に向かう気力が残っていないことが多いです。
[理想の姿] カエデ: 続かないと感じるのは、どんな場面でしょうか。
[理想の姿] ユーザー: 平日の夜です。帰宅すると疲れて手が止まります。エディタを開くまでに一時間くらいスマホを見てしまうこともあります。始めてしまえば集中はできます。
[理想の姿] カエデ: 始められた日は、何が違いましたか。
[理想の姿] ユーザー: 前の日に「次はここをやる」と決めてあった日は始められています。三日坊主になりがちなのは昔からで、去年も同じことで一度やめました。
[具体化] カエデ: 1年後、それがうまくいっているとしたら、どうなっていますか。
[具体化] ユーザー: 自分以外の誰かが週に一度は開いてくれている状態です。3人くらいでいいです。作ったものが人に使われている実感が持てると続くのだと思います。
[具体化] カエデ: いつまでに、どうなっていれば「できた」と言えますか。
[具体化] ユーザー: 半年後、つまり2027年2月末までに、週1回使ってくれる人が3人。それを測れるようにログを取りたいです。
[障害と明日の一歩] カエデ: つまずきそうなのは、どこでしょうか。
[障害と明日の一歩] ユーザー: 平日の夜、21時に机に座れないときです。そうなったら翌朝6時に15分だけやる、というふうにしたいです。
[障害と明日の一歩] カエデ: 明日、最初にやることを1つ決めるとしたら。
[障害と明日の一歩] ユーザー: 説明が足りていない画面に、説明を1行ずつ足します。30分くらいだと思います。`;

const t0 = Date.now();
const res = await client.messages.parse({
  model: STRUCTURE_MODEL,
  max_tokens: 16000,
  system: STRUCTURE_EXTRACTION_PROMPT,
  messages: [{ role: "user", content: transcript }],
  output_config: { format: zodOutputFormat(GoalCardSchema) },
});
const sec = Math.round((Date.now() - t0) / 100) / 10;

const u = res.usage;
console.log(
  `入力 ${u.input_tokens}  出力 ${u.output_tokens}  ${sec}秒  ` +
    `（入力の ${Math.round((u.output_tokens / u.input_tokens) * 10) / 10} 倍が出力）`,
);

const out = res.parsed_output;
if (!out) {
  console.log("NG: parsed_output が null。max_tokens 不足かスキーマ違反");
  process.exitCode = 1;
} else {
  console.log("");
  console.log("vision案1 :", out.visionOptions[0]);
  console.log("案の数    :", {
    vision: out.visionOptions.length,
    specific: out.smart.specificOptions.length,
    measurable: out.smart.measurableOptions.length,
  });
  console.log("profile   :", JSON.stringify(out.profile, null, 2));

  const p = out.profile;
  const filled =
    p.lifePatterns.length + p.pastFailures.length + p.valuesAccumulated.length;
  if (filled > 0) {
    console.log(`\nOK: 1回の呼び出しで成果物と profile を同時に取れた（${filled} 項目）`);
  } else {
    console.log("\nNG: profile が空。相乗りの指示がプロンプトに届いていない");
    process.exitCode = 1;
  }
}
